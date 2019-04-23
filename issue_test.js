'use strict';
var mysql = require('mysql');
var read = require('read-yaml');
var config = read.sync('config.yaml');
const util = require('util');
const billcoin = require('./app/billcoin');

const axios = require('axios');

const salery = 1000;

const BLOCK_OK = 0;
const BLOCK_COMPLETE = 1;
const BLOCK_VOID = 2;
const BLOCK_INCOMPLTE = 3;
const BLOCK_INVALID = 3;



var select_query_for_issue_billcoin = "SELECT `db_table_prefix_companycode_employee_working_days`.employee_id, `db_table_prefix_companycode_employees`.`block_user_id`, `db_table_prefix_companycode_employee_working_days`.date, SUM(`db_table_prefix_companycode_concluded_employee_working_informations`.`real_working_hour`) AS working_hours \
    FROM `db_table_prefix_companycode_employee_working_days` \
    LEFT JOIN `db_table_prefix_companycode_concluded_employee_working_informations` \
    ON `db_table_prefix_companycode_employee_working_days`.id=`db_table_prefix_companycode_concluded_employee_working_informations`.`employee_working_day_id`\
    LEFT JOIN `db_table_prefix_companycode_employees`\
    ON `db_table_prefix_companycode_employee_working_days`.employee_id=`db_table_prefix_companycode_employees`.id \
    WHERE `db_table_prefix_companycode_employee_working_days`.`concluded_level_one`=1 AND `db_table_prefix_companycode_employee_working_days`.`prepaid`=1\
    AND `db_table_prefix_companycode_employee_working_days`.`date`<=?\
    GROUP BY `db_table_prefix_companycode_employee_working_days`.id"
var select_query_for_paying_setting = "SELECT complete_time, prepaid_percent FROM `db_table_prefix_companycode_paying_settings` ORDER BY id LIMIT 1"
var select_query_for_company_user = "SELECT block_user_id FROM `db_table_prefix_companycode_companies`";
var insert_block_query = "insert into caeru_spd_db_billcoin_blocks (version, complete_time, working_day, price, state, issuer_id, owner_id) values(?,?,?,?,?,?,?)";

var billcoin_db_con = mysql.createConnection({
    host: config.billcoin_db.host,
    port: config.billcoin_db.port,
    user: config.billcoin_db.usr,
    password: config.billcoin_db.password,
    database: config.billcoin_db.db_name
});
const billcoin_query = util.promisify(billcoin_db_con.query).bind(billcoin_db_con);


async function getPayingSetting(con, working_day){
    var d = new Date(working_day);
    const query = util.promisify(con.query).bind(con);

    let result = await query(select_query_for_paying_setting);
    let complete_time = result[0].complete_time;
    let prepaid_percent = result[0].prepaid_percent;
    
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    d.setHours(complete_time);
    console.log(d);
    return [d, prepaid_percent];
}

async function getCompanyId(con){
    const query = util.promisify(con.query).bind(con);
    let result = await query(select_query_for_company_user);
    return result[0].block_user_id;
}

async function addBlock(block){

    let result = await billcoin_query(insert_block_query, [
        block.version, 
        block.complete_time, 
        block.working_day, 
        block.price, 
        block.state, 
        block.issuer_id, 
        block.owner_id
    ]);
    block.id = result.insertId;
    return block;
}


var issueBillcoin = async function(company_code, working_day){
    let db_table_prefix = "caeru_spd_db";
    var webserver_db_con = mysql.createConnection({
        host: config.webserver_db.host,
        port: config.webserver_db.port,
        user: config.webserver_db.usr,
        password: config.webserver_db.password,
        database: db_table_prefix + "_" + company_code,
    });

    
    
    const query = util.promisify(webserver_db_con.query).bind(webserver_db_con);
    select_query_for_issue_billcoin = select_query_for_issue_billcoin.replace(/db_table_prefix/g, db_table_prefix);
    select_query_for_issue_billcoin = select_query_for_issue_billcoin.replace(/companycode/g, company_code);
    select_query_for_paying_setting = select_query_for_paying_setting.replace(/db_table_prefix/g, db_table_prefix);
    select_query_for_paying_setting = select_query_for_paying_setting.replace(/companycode/g, company_code);
    select_query_for_company_user = select_query_for_company_user.replace(/db_table_prefix/g, db_table_prefix);
    select_query_for_company_user = select_query_for_company_user.replace(/companycode/g, company_code);

    let [complete_time, prepaid_percent] = await getPayingSetting(webserver_db_con, working_day);
    let company_user_id = await getCompanyId(webserver_db_con);
    console.log(complete_time, prepaid_percent, company_user_id);

    let result = await query(select_query_for_issue_billcoin, working_day);
    let blocks = [];
    let data = [];
    for(var idx in result){
        let row = result[idx];
        blocks.push({
            version: 0,
            complete_time: complete_time,
            working_day: row.date,
            price: row.working_hours / 60 * salery * prepaid_percent / 100,
            state: BLOCK_INCOMPLTE,
            issuer_id: company_user_id,
            owner_id: row.block_user_id,
            working_hours: row.working_hours,
            all_price: row.working_hours / 60 * salery,
            hourly_salery: salery,
            prepaid_percent: prepaid_percent
        });
    }

    //for(var idx in blocks){
    for(var idx = 0; idx < 2; idx++){
        let block = blocks[idx];
        blocks[idx] = await addBlock(block);
        console.log(blocks[idx]);
    }

    var block_data = [];

    //for(var idx in blocks){
    for(var idx = 0; idx < 2; idx++){
        let block = blocks[idx];
        block_data.push({
            id: block.id,
            owner: block.owner_id,
            value: block.price,
        });
    }

    billcoin.IssueBillcoins(company_user_id, complete_time, block_data);
}

issueBillcoin("itz5", "2018-10-2");
