
'use strict' ;

const log4js = require('log4js');
log4js.configure(__dirname + '/logger_config.json', {reloadSecs: 30});
 
const logger = log4js.getLogger('bcs');

var express = require('express');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var http = require('http');
var util = require('util');
var app = express();
var expressJWT = require('express-jwt');
var jwt = require('jsonwebtoken');
var bearerToken = require('express-bearer-token');
var cors = require('cors');
var billcoindb = require('./app/billcoindb.js');

var read = require('read-yaml');
var config = read.sync('config.yaml');

var billcoin = require('./app/billcoin.js');
// var query = require('./app/query.js');
var host = config.WebService.host || process.env.HOST || '127.0.0.1';
var port = config.WebService.port || process.env.PORT || '8000';
///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// SET CONFIGURATONS ////////////////////////////
///////////////////////////////////////////////////////////////////////////////
app.options('*', cors());
app.use(cors());
//support parsing of application/json type post data
app.use(bodyParser.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({
	extended: false
}));

// set secret variable
// app.set('secret', 'thisismysecret');
// app.use(expressJWT({
// 	secret: 'thisismysecret'
// }).unless({
// 	path: ['/users']
// }));
//app.use(bearerToken());

app.use(function(req, res, next) {
	logger.debug(' ------>>>>>> new request for %s',req.originalUrl);
	if (req.originalUrl.indexOf('/users') >= 0) {
		return next();
	}

	// var token = req.token;
	// jwt.verify(token, app.get('secret'), function(err, decoded) {
	// 	if (err) {
	// 		res.send({
	// 			success: false,
	// 			message: 'Failed to authenticate token. Make sure to include the ' +
	// 				'token returned from /users call in the authorization header ' +
	// 				' as a Bearer token'
	// 		});
	// 		return;
	// 	} else {
	// 		// add the decoded user name and org name to the request object
	// 		// for the downstream code to use
	// 		req.username = decoded.username;
	// 		req.orgname = decoded.orgName;
	// 		logger.debug(util.format('Decoded from JWT token: username - %s, orgname - %s', decoded.username, decoded.orgName));
	// 		return next();
	// 	}
  // });
  
  return next();
});

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
var server = http.createServer(app).listen(port, function() {});
logger.info('****************** SERVER STARTED ************************');
logger.info('***************  http://%s:%s  ******************',host,port);
server.timeout = 240000;

function getErrorMessage(field) {
	var response = {
		success: false,
		message: field + ' field is missing or Invalid in the request'
	};
	return response;
}

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////


app.post('/api/IssueBillcoins', async function(req, res) {
	let issuer = req.body.issuer;
	let finalDate = req.body.final_date;
	let data = req.body.data;

	await billcoin.ResolveToken();

	logger.info(">>>/api/IssueBillcoins", issuer, finalDate, data);
	let err = await billcoin.IssueBillcoins(issuer, finalDate, data);
    res.json({
      success: (!err) ? true : false, 
      message: (!err) ? "" : err
    })
});

app.post('/api/CollectBillcoins', async function(req, res) {
	let ids = req.body;

	await billcoin.ResolveToken();

	logger.info(">>>/api/CollectBillcoins", ids);
	let ret = await billcoin.CollectBillcoins(ids);
    res.json({
      success: (ret) ? true : false, 
      message: (ret) ? ret : ""
    })
});

app.post('/api/SplitBillcoin', async function(req, res) {
	let src = req.body.src;
	let dst1 = req.body.dst1;
	let dst2 = req.body.dst2;

	await billcoin.ResolveToken();

	logger.info(">>>/api/SplitBillcoin", src, dst1, dst2);
	let err = await billcoin.SplitBillcoin(src, dst1, dst2);
    res.json({
		success: (!err) ? true : false, 
		message: (!err) ? "" : err
	  });
  });

app.post('/api/SellBillcoins', async function (req, res) {
	let seller = req.body.seller;
	let buyer = req.body.buyer;
	let ids = req.body.ids;

	await billcoin.ResolveToken();

	logger.info(">>>/api/SellBillcoins", seller, buyer, ids);
	let err = await billcoin.SellBillcoins(seller, buyer, ids);
	res.json({
		success: (!err) ? true : false,
		message: (!err) ? "" : err
	});
});

app.post('/api/FreeBillcoins', async function (req, res) {
	let ids = req.body.ids;

	await billcoin.ResolveToken();

	logger.info(">>>/api/FreeBillcoins", ids);
	let err = await billcoin.FreeBillcoins(ids);
	res.json({
		success: (!err) ? true : false,
		message: (!err) ? "" : err
	});
});

app.post('/issue', async function(req, res){
	let working_day = req.body.working_day;
	let company_code = req.body.company_code;
	let result = await billcoindb.issueBillcoins(company_code, working_day);
	res.json({
		success: (!result) ? true: false,
		message: (!result) ? "" : result
	})
});

app.post('/sell', async function(req, res){
	let seller_id = req.body.seller_id;
	let purchaser_id = req.body.purchaser_id;
	let issuer_id = req.body.issuer_id;
	let sell_price = req.body.sell_price;
	let working_month = req.body.working_month;
	let result = await billcoindb.sellBillcoins(seller_id, purchaser_id, issuer_id, sell_price, working_month);
	res.json({
		success: (!result) ? true: false,
		message: (!result) ? "" : result
	})
});

app.post('/free', async function(req, res){
	let company_code = req.body.company_code;
	let end_time = req.body.end_time;
	let option = req.body.option;
	billcoindb.freeBillcoins(company_code, end_time, option);
	res.json({
		success: true,
		message: ""
	})	
});

app.get('/settlement_info', async function(req, res){
	let result = await billcoindb.settlementInformation();
	res.json({
		success: result ? true: false,
		message: result
	})
});

//-----------------------------------------------------
// catch 404 and forward to error handler
//app.use(function(req, res, next) {
//  next(createError(404));
//});

