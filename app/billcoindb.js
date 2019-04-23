'use strict';
var mysql = require('mysql');
var read = require('read-yaml');
var config = read.sync('config.yaml');
const util = require('util');
const billcoin = require('./billcoin');
const dateformat = require('dateformat');
const moment = require('moment');

const log4js = require('log4js');
log4js.configure(__dirname + '/../logger_config.json', {reloadSecs: 30});
 const logger = log4js.getLogger('bcs');

const axios = require('axios');

const salery = 1000;

const BLOCK_OK = 0;
const BLOCK_COMPLETE = 1;
const BLOCK_VOID = 2;
const BLOCK_INCOMPLTE = 3;
const BLOCK_INVALID = 3;

const TRANSACTION_BANK_API_CALL = 3;
const TRANSACTION_SPLIT_BLOCK = 2;
const TRANSACTION_TRANSACTION = 1;
const TRANSACTION_COMPLETE = 0;
const TRANSACTION_INVALID = -1;
const TRANSACTION_CONCLUDE_BANK = 5;
const TRANSACTION_CONCLUDE_BLOCK = 2;

var settlement_total = 0;
var settlement_finished = 0;
var settlement_state = 0;


const billcoin_db_con = mysql.createConnection({
    host: config.billcoin_db.host,
    port: config.billcoin_db.port,
    user: config.billcoin_db.usr,
    password: config.billcoin_db.password,
    database: config.billcoin_db.db_name
});

const billcoin_query = util.promisify(billcoin_db_con.query).bind(billcoin_db_con);

const g_select_query_for_issue_billcoin = "SELECT `db_table_prefix_companycode_employee_working_days`.id, `db_table_prefix_companycode_employee_working_days`.employee_id, `db_table_prefix_companycode_employees`.`block_user_id`, `db_table_prefix_companycode_employee_working_days`.date, SUM(`db_table_prefix_companycode_concluded_employee_working_informations`.`real_working_hour`) AS working_hours \
    FROM `db_table_prefix_companycode_employee_working_days` \
    LEFT JOIN `db_table_prefix_companycode_concluded_employee_working_informations` \
    ON `db_table_prefix_companycode_employee_working_days`.id=`db_table_prefix_companycode_concluded_employee_working_informations`.`employee_working_day_id`\
    LEFT JOIN `db_table_prefix_companycode_employees`\
    ON `db_table_prefix_companycode_employee_working_days`.employee_id=`db_table_prefix_companycode_employees`.id \
    WHERE `db_table_prefix_companycode_employee_working_days`.`concluded_level_one`=1 AND `db_table_prefix_companycode_employee_working_days`.`prepaid`=0\
    AND `db_table_prefix_companycode_employee_working_days`.`date`=?\
    GROUP BY `db_table_prefix_companycode_employee_working_days`.id"
const g_select_query_for_paying_setting = "SELECT complete_time, prepaid_percent FROM `db_table_prefix_companycode_paying_settings` ORDER BY id LIMIT 1"
const g_select_query_for_company_user = "SELECT block_user_id FROM `db_table_prefix_companycode_companies`";
const g_update_prepaid_query = "update db_table_prefix_companycode_employee_working_days set prepaid=1 where id=?"

const insert_block_query = "insert into blocks (version, complete_time, working_day, price, state, issuer_id, owner_id, created_at) values(?,?,?,?,?,?,?,?)";
const insert_block_info_query = "insert into block_informations (block_id, block_user_id, date, working_hours, prepaid_price, all_price, hourly_salery, prepaid_percent, created_at) values(?,?,?,?,?,?,?,?,?)";
const update_block_query = "update blocks set version=?, complete_time=?, working_day=?, price=?, state=?, issuer_id=?, owner_id=?, updated_at=? where id=?";
const select_one_block_query = "select * from  blocks where id=?";
const select_block_query = "select * from  blocks";
const insert_transaction_query = "insert into block_transactions (working_month, owner_id, sell_price, issuer_id, purchaser_id, state, buy_price, api_fee, use_fee, created_at) values (?,?,?,?,?,?,?,?,?,?)"
const update_transaction_query = "update block_transactions set working_month=?, owner_id=?, sell_price=?, issuer_id=?, purchaser_id=?, state=?, buy_price=?, api_fee=?, use_fee=?, updated_at=? where id=?"
const select_buysetting_query = "select * from bill_coin_buy_settings where issuer_id=? and purchaser_id=?"
const insert_trasanction_block_query = "insert into transaction_blocks (block_transaction_id, block_id) values (?,?)"
const select_issuer_id_from_company_code = "select id from block_users where presentation_id=? and type=0"


let currentTimestamp = function(){
    return moment(Date.now()).format('YYYY-MM-DD HH:mm:ss');
}

async function getPayingSetting(con, working_day, db_table_prefix, company_code){
    let select_query_for_paying_setting = g_select_query_for_paying_setting.replace(/db_table_prefix/g, db_table_prefix);
    select_query_for_paying_setting = select_query_for_paying_setting.replace(/companycode/g, company_code);

    try{
        var d = new Date(working_day);
        const query = util.promisify(con.query).bind(con);
        let result = await query(select_query_for_paying_setting);
    
        if(result.length == 0)
            return null;

        let complete_time = result[0].complete_time;
        let prepaid_percent = result[0].prepaid_percent;
        
        d.setMonth(d.getMonth() + 1);
        d.setDate(1);
        d.setHours(complete_time);
        return [d, prepaid_percent];
    }
    catch(error)
    {
        return null;
    }
}

async function updatePrepaid(con, working_day_id, db_table_prefix, company_code){
    let update_prepaid_query = g_update_prepaid_query.replace(/db_table_prefix/g, db_table_prefix);
    update_prepaid_query = update_prepaid_query.replace(/companycode/g, company_code);

    try{
        const query = util.promisify(con.query).bind(con);
        await query(update_prepaid_query, working_day_id);
        return null;
    }
    catch(error){
        return "Error update prepiad";
    }
}

async function getCompanyId(con, db_table_prefix, company_code){
    let select_query_for_company_user = g_select_query_for_company_user.replace(/db_table_prefix/g, db_table_prefix);
    select_query_for_company_user = select_query_for_company_user.replace(/companycode/g, company_code);

    try{
        const query = util.promisify(con.query).bind(con);
        let result = await query(select_query_for_company_user);
        if(result.length == 0)
            return null;
        return result[0].block_user_id;
    }
    catch(error)
    {
        return null;
    }
}

async function addBlockInfo(block, id){
    try{
        let result = await billcoin_query(insert_block_info_query, [
            id,
            block.owner_id,
            block.working_day,
            block.working_hours / 60,
            block.price,
            block.working_hours / 60 * block.hourly_salery,
            block.hourly_salery,
            block.prepaid_percent,
            currentTimestamp()
        ]);
        return null;
    }
    catch(error)
    {
        return "Error add Block info";
    }
}


async function updateBlock(block){
    try{
        await billcoin_query(update_block_query, [
            block.version, 
            block.complete_time, 
            block.working_day, 
            block.price, 
            block.state, 
            block.issuer_id, 
            block.owner_id,
            currentTimestamp(),
            block.id
        ]);
        return null;
    }
    catch(error)
    {
        return "Error update Block";
    }
}

async function addBlock(block){
    try{
        let result = await billcoin_query(insert_block_query, [
            block.version, 
            block.complete_time, 
            block.working_day, 
            block.price, 
            block.state, 
            block.issuer_id, 
            block.owner_id,
            currentTimestamp()
        ]);
        block.id = result.insertId;
        return block;
    }
    catch(error)
    {
        return "Error add Block";
    }
}

async function selectBlocks(conditions){

    try{
        let query = select_block_query;
        if(conditions.length > 0){
            query += ' where ' + conditions.join(" and ");
        }
        let result = await billcoin_query(query);
        return result;        
    }
    catch(error)
    {
        return null;
    }
}


async function bankApiCall(transaction_id, from_id, to_id, price, percent){
    price = price * percent / 100;
    let api_fee = 100;
    let use_fee = 100;
    return true;   
}

async function getBlock(block_id){
    try{
        let result = await billcoin_query(select_one_block_query, block_id);
        if(result.length == 0)
            return null;
        return result[0];
    }
    catch(error)
    {
        return null;
    }
}

async function getBuysetting(issuer_id, purchaser_id){
    try
    {
        let result = await billcoin_query(select_buysetting_query, [
            issuer_id,
            purchaser_id
        ]);
        if(result.length == 0){
            return null;
        }
        return result[0];
    }
    catch(error)
    {
        return null;
    }
    
}

async function addTransactionBlock(transaction_id, block_id){
    try{
        let result = await billcoin_query(insert_trasanction_block_query, [
            transaction_id,
            block_id
        ]);
        return null;
    }
    catch(error)
    {
        return "Error add Transaction Block";
    }
}

async function addTransaction(transaction){
    try{
        let result = await billcoin_query(insert_transaction_query, [
            transaction.working_month,
            transaction.owner_id,
            transaction.sell_price,
            transaction.issuer_id,
            transaction.purchaser_id,
            transaction.state,
            transaction.buy_price,
            transaction.api_fee,
            transaction.use_fee,
            currentTimestamp(),
        ]);
        transaction.id = result.insertId;
        return transaction;
    }
    catch(error)
    {
        return null;
    }
}

async function updateTransaction(transaction){
    try{
        let result = await billcoin_query(update_transaction_query, [
            transaction.working_month,
            transaction.owner_id,
            transaction.sell_price,
            transaction.issuer_id,
            transaction.purchaser_id,
            transaction.state,
            transaction.buy_price,
            transaction.api_fee,
            transaction.use_fee,
            currentTimestamp(),
            transaction.id
        ]);
        return null;
    }
    catch(error)
    {
        return "Error update transaction";
    }
}

async function getCompanyIdFromCompanyCode(company_code){
    try{
        let result = await billcoin_query(select_issuer_id_from_company_code, company_code);
        if(result.length == 0)
            return null;
        return result[0].id;
    }
    catch(error)
    {
        return null;
    }
}



var issueBillcoins = async function(company_code, working_day){

    let db_table_prefix = config.webserver_db.table_prefix;
    let db_setting = {
        host: config.webserver_db.host,
        port: config.webserver_db.port,
        user: config.webserver_db.usr,
        password: config.webserver_db.password,
        database: db_table_prefix + "_" + company_code,
    };

    try{
        var webserver_db_con = mysql.createConnection(db_setting);
        var query = util.promisify(webserver_db_con.query).bind(webserver_db_con);
    }
    catch(error)
    {
        return "Error connect webserver db\n" + JSON.stringify(db_setting);
    }
 
    

    let select_query_for_issue_billcoin = g_select_query_for_issue_billcoin.replace(/db_table_prefix/g, db_table_prefix);
    select_query_for_issue_billcoin = select_query_for_issue_billcoin.replace(/companycode/g, company_code);

    let pay_setting = await getPayingSetting(webserver_db_con, working_day, db_table_prefix, company_code);
    if(pay_setting == null)
    {
        return "Error get paying setting";
    }
    let complete_time = pay_setting[0];
    let prepaid_percent = pay_setting[1];


    let company_user_id = await getCompanyId(webserver_db_con, db_table_prefix, company_code);

    if(company_user_id == null)
    {
        return "Can not get company id of this database";
    }

    let result = await query(select_query_for_issue_billcoin, working_day);

    if(result == null)
    {
        return "Can not get billcoin to be issued";
    }

    let blocks = [];
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
            prepaid_percent: prepaid_percent,
            working_day_id: row.id
        });
    }


    for(var idx in blocks){
        let block = blocks[idx];
        blocks[idx] = await addBlock(block);
        if(blocks[idx] == null){
            return "Error create block";
        }
        let add_info_result = await addBlockInfo(block, blocks[idx].id);
        if(add_info_result)
        {
            return add_info_result;
        }
    }

    var block_data = [];

    for(var idx in blocks){
        let block = blocks[idx];
        block_data.push({
            id: block.id.toString(),
            owner: block.owner_id.toString(),
            value: block.price,
        });
    }

    await billcoin.ResolveToken();
    let issue_result = await billcoin.IssueBillcoins(company_user_id.toString(), complete_time, block_data);
    if(issue_result){
        return issue_result;
    }

    for(var idx in blocks){
        let block = blocks[idx];
        await updatePrepaid(webserver_db_con, block.working_day_id, db_table_prefix, company_code);
        block.state = BLOCK_OK;
        await updateBlock(block);
    }
}


var splitBillcoin = async function(block_id, split_price){
    let block = await getBlock(block_id);
    if(block == null){
        return "Can not get block:" + block_id;
    }
    block.state = BLOCK_INCOMPLTE;
    let div1 = Object.assign({}, block);
    let div2 = Object.assign({}, block);
    div1.price = split_price;
    div2.price = block.price - split_price;

    div1 = await addBlock(div1);
    div2 = await addBlock(div2);

    if(div1 == null || div2 == null){
        return "Can not create block:" + JSON.stringify(div1) + "\n" + JSON.stringify(div2);
    }

    let update_block_result = await updateBlock(block);
    if(update_block_result)
    {
        return "Can not update block:" + update_block_result;
    }

    await billcoin.ResolveToken();
    let split_result = await billcoin.SplitBillcoin(block_id.toString(), {
        id: div1.id.toString(),
        value: div1.price
    },{
        id: div2.id.toString(),
        value: div2.price
    });

    if(split_result){
        return split_result;
    }

    block.state = BLOCK_VOID;
    div1.state = BLOCK_OK;
    div2.state = BLOCK_OK;

    if((await updateBlock(div1)) || (await updateBlock(div2)) || (await updateBlock(block))) {
        return "Can not update block"
    }

    return [div1.id, div2.id]
}

var sellBillcoins = async function(seller_id, purchaser_id, issuer_id, sell_price, working_month){
    let transaction = await addTransaction({
        owner_id: seller_id,
        working_month: working_month,
        sell_price: sell_price,
        issuer_id: issuer_id,
        purchaser_id: purchaser_id,
        state: TRANSACTION_BANK_API_CALL,
        buy_price: 0,
        api_fee: 0,
        use_fee: 0
    });


    if(transaction == null){
        return "Add transaction error";
    }

    let buySetting = await getBuysetting(issuer_id, purchaser_id);

    if(buySetting == null){
        return "Get buysetting error";
    }

    transaction.api_fee = 100;
    transaction.use_fee = 150;
    transaction.buy_price = transaction.sell_price * buySetting.percent / 100;
    
    let bankApiCallResult = await bankApiCall(transaction.id, purchaser_id, seller_id, sell_price, buySetting.percent);

    if(bankApiCallResult == false){
        return "Call Bank api error";
    }

    transaction.state = TRANSACTION_SPLIT_BLOCK;

    await updateTransaction(transaction);

    let blocks = await selectBlocks([
        'owner_id=' + transaction.owner_id,
        'state=' + BLOCK_OK,
        'working_day>="' + working_month+'-1"',
        'working_day<="' + working_month+'-31"',
        'issuer_id=' + issuer_id
    ]);

    if(blocks == null){
        return "Can't select blocks" + JSON.stringify(blocks);
    }

    let sum = 0;
    let EPS = 1e-6;
    let block_ids = [];

    for(let idx in blocks){
        let block = blocks[idx];
        if(sum + block.price < sell_price - EPS){
            let add_result = await addTransactionBlock(transaction.id, block.id);
            if(add_result){
                return "Add transaction block for block: " + block.id;
            }
            block_ids.push(block.id);
        }
        else{
            if(Math.abs(sum + block.price - sell_price <= EPS)){
                await addTransactionBlock(transaction.id, block.id);
                block_ids.push(block.id);
            }else{
                
                let split_result = await splitBillcoin(block.id, sell_price - sum);
                if(Array.isArray(split_result) == false){
                    return "split failed";
                }
                let [div1_id, div2_id] = split_result;
                let add_result = await addTransactionBlock(transaction.id, div1_id);

                if(add_result){
                    return "Add transaction block error after split";
                }

                block_ids.push(div1_id);
            }
            transaction.state = TRANSACTION_TRANSACTION;
            await updateTransaction(transaction);
            break;
        }
        sum += block.price;
    }

    console.log(block_ids);

    for(var idx in block_ids){
        let block_id = block_ids[idx];
        let block = await getBlock(block_id);
        block.state = BLOCK_INCOMPLTE;
        await updateBlock(block);
    }

    await billcoin.ResolveToken();
    let sell_result = await billcoin.SellBillcoins(seller_id.toString(), purchaser_id.toString(), block_ids.map(String));
    if(sell_result){
        return sell_result;
    }

    for(var idx in block_ids){
        let block_id = block_ids[idx];
        let block = await getBlock(block_id);
        block.owner_id = purchaser_id;
        block.state = BLOCK_OK;
        await updateBlock(block);
    }

    transaction.state = TRANSACTION_COMPLETE;

    await updateTransaction(transaction);

    return null;
}

function groupBy(list, keyGetter) {
    const map = new Map();
    list.forEach((item) => {
        const key = keyGetter(item);
        const collection = map.get(key);
        if (!collection) {
            map.set(key, [item]);
        } else {
            collection.push(item);
        }
    });
    return map;
}


var freeBillcoins = async function(company_code, end_day, flag){
    if(settlement_state)
        return;
    settlement_state = 1;
    settlement_total = 0;

    let issuer_id = await getCompanyIdFromCompanyCode(company_code);

    let select_option = [
        'issuer_id='+issuer_id,
        'state='+BLOCK_OK
    ];

    if(flag == 'working_day')
        select_option.push('working_day<="' + end_day + '"');
    else
        select_option.push('complete_time<="' + end_day + '"');
    

    let blocks = await selectBlocks(select_option);
    

    let groups = await groupBy(blocks, (item) =>
     item.owner_id + '-' + dateformat(item.complete_time, 'yyyy-mm-dd HH:MM:ss') + '-' + item.issuer_id
    );

    settlement_total = groups.size;

    for(var entry of groups.entries()){
        settlement_finished++;

        let group = entry[1];
        let block = group[0];
        let price = 0;
        for(var idx in group){
            price += group[idx].price;
        }
        
        let working_month = dateformat(block.working_day, "yyyy-mm");
        let transaction = await addTransaction({
            state: TRANSACTION_CONCLUDE_BANK,
            working_month: working_month,
            issuer_id: block.issuer_id,
            owner_id: block.owner_id,
            purchaser_id: block.issuer_id,
            sell_price: price,
            buy_price: 0,
            use_fee: 0,
            api_fee: 0,
        });

        var block_ids = [];

        for(var idx in group){
            await addTransactionBlock(transaction.id, group[idx].id);
            block_ids.push(group[idx].id);
        }
        

        bankApiCall(transaction.id, block.issuer_id, block.owner_id, price, 100);
        
        transaction.state = TRANSACTION_CONCLUDE_BLOCK;
        transaction.buy_price = transaction.sell_price;
        transaction.api_fee = 100;
        transaction.use_fee = 150;
        await updateTransaction(transaction);

        for(var idx in block_ids){
            let block_id = block_ids[idx];
            let block = await getBlock(block_id);
            block.state = BLOCK_COMPLETE;
            block.owner_id = issuer_id;
            await updateBlock(block);
        }

        await billcoin.ResolveToken();
        let result = await billcoin.FreeBillcoins(block_ids.map(String));
        if(result){
            settlement_state = 0;
            return result;
        }

        transaction.state = TRANSACTION_COMPLETE;
        await updateTransaction(transaction);
    }
    settlement_state = 0;
    settlement_total = 0;
}

let settlementInformation = async function(){
    return {
        state: settlement_state,
        current: settlement_finished,
        total: settlement_total
    };
}

exports.settlementInformation = settlementInformation;

//issueBillcoins("itz1", "2018-10-8");
//splitBillcoin(1001, 5000);
//sellBillcoins(586, 904, 302, 20000, '2018-10');
//freeBillcoins('2018-11-8');

exports.issueBillcoins = issueBillcoins;
exports.sellBillcoins = sellBillcoins;
exports.freeBillcoins = freeBillcoins;