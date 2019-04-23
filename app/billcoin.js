'use strict';

const axios = require('axios');
const util = require('util');

const log4js = require('log4js');
log4js.configure(__dirname + '/../logger_config.json', {reloadSecs: 30});
 const logger = log4js.getLogger('bcs');

var read = require('read-yaml');
var config = read.sync('config.yaml');

var fabricClientHost = config.FabricClient.host;
var fabricClientPort = config.FabricClient.port;
var host = util.format('%s:%d', fabricClientHost, fabricClientPort);

const dealerPeers = config.FabricClient.DealerPeers;
const issuerPeers = config.FabricClient.IssuerPeers;

var tokenJim;
var tokenBarry;


/**
 * Fabric Client와 통신하기 위한 토큰 문자열을 얻는다.
 * 
 * @param {조직내의 사용자이름} userName 
 * @param {조직이름} orgName 
 * @return 토큰 문자열
 */
async function getToken(userName, orgName){
    try{
        let reqUrl = 'http://' + host + '/users';
        let postData = {
            username: userName,
            orgName: orgName
        };
        let axiosConfig = {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8'
            }
        };    
        let response = await axios.post(reqUrl, postData, axiosConfig);

        logger.info("%s/%s token : %s", userName, orgName, response.data.token)
        
        let ret = response.data.token;
        return ret;
    }
    catch(error){
        return null;
    }
}

/**
 * 블록체인에 대한 조회요청을 진행.
 * 조회요청의 본질은 블록체인에 대한 조회기능을 수행하는 
 * 체인코드함수에 대한 호출과 그 함수가 귀환하는 처리결과에 대한 접수이다.
 * 
 * @param {Fabric Client와의 통신을 위한 토큰 문자열} token 
 * @param {요청을 보내기 위한 피어이름} peer 
 * @param {요청을 처리할 체인코드 함수 이름} funcName 
 * @param {체인코드 함수에 넘겨줄 파라미터 배열} args 
 * 
 * @return 체인코드 함수에서 귀환한 데이터를 포함한 Fabric Client의 귀환값. 
 *      result.data 에 체인코드 함수의 귀환데이터가 들어있다.
 */
async function callQuery(token, peer, funcName, args){
    let reqUrl = 'http://' + host + '/query/channels/mychannel/chaincodes/billcoincc';
    let postData = {
        peer: peer,
        fcn: funcName,
        args: args
    };

    let axiosConfig = {
        headers: {
            authorization: "Bearer " + token,
            'Content-Type': 'application/json;charset=UTF-8'
        }
    };  
    let response = await axios.post(reqUrl, postData, axiosConfig); 
    return response;
}

/**
 * 
 * @param {Fabric Client와의 통신을 위한 토큰 문자열} token 
 * @param {요청을 보내기 위한 피어이름} peer 
 * @param {요청을 처리할 체인코드 함수 이름} funcName 
 * @param {체인코드 함수에 넘겨줄 파라미터 배열} args 
 * 
 * @return 체인코드 함수에서 귀환한 문자열 귀환값. 
 *      result.success 값이 true이면 체인코드의 invoke 호출이 성공하였음을 나타낸다.
 */
async function callInvoke(token, peers, fcn, args){
    let reqUrl = 'http://' + host + '/channels/mychannel/chaincodes/billcoincc';
    let postData = {
        peers: peers,
        fcn: fcn,
        args: args
    };
    let axiosConfig = {
        headers: {
            authorization: "Bearer " + token,
            'Content-Type': 'application/json;charset=UTF-8'
        }
    };    
    let response = await axios.post(reqUrl, postData, axiosConfig);
    //console.log(response);
    return response;
}

 /**
  * 채권 발행요청을 Fabric Client에 전송한다.
  * 발행자가 한번에 발행하는 1개 이상의 채권을 지적한다.
  * 발행되는 모든채권의 '발행자', '완료날자'는 동일하다. 기타의 필드는 각각 다를수 있다.
  * JSON 실례
    {
        issuer: "alice",
        final_date: "2018-12-31T10:10:10+009:00",
        data: [
            { id: "1001", owner: "aaaaaa", value: 1000},
            { id: "1002", owner: "bbbbbb", value: 2000},
            { id: "1003", owner: "cccccc", value: 3000}
        ]
    }
  * 
  * @param  issuer 발행자 아이디
  * @param finalDate 채권 해결 날자
  * @param data 발행채권자료.
  *     실례) 
  *     data: [
            { id: "1001", owner: "aaaaaa", value: 1000},
            { id: "1002", owner: "bbbbbb", value: 2000},
            { id: "1003", owner: "cccccc", value: 3000}
        ]
    @return 오유. 성공한경우 null을 귀환.
  */
var IssueBillcoins = async function(issuer, finalDate, data){
    try {
        var bcData = {
            issuer: issuer,
            final_date: (typeof finalDate) == 'string' ? finalDate : finalDate.toJSON(),
            data: data
        }    
        var dataString = JSON.stringify(bcData);
        logger.info("data string:\n%s", dataString);
    
        let result = await callInvoke(tokenJim, dealerPeers, 'issue', [dataString]);
        console.log('issue result: ', result.data);
        return null;
    }
    catch(error){
        logger.error("Issue error:" + error.stack ? error.stack : error);
        return error;
    }
}

/**
 * 한개의 채권을 두개로 분할한다.
 * JSON 실례
 * {
        "src" : "11111111",
        "dst" : [
            { "id" : "div1111111", "value" : "40" },
            { "id" : "div2222222", "value" : "60" }
        ]
	}
 * 
 * @param {분할하려는 채권 ID 문자열} srcID 
 * @param {분할 결과의 첫번째 채권 정보} dst1 
 *      ex) { "id" : "div1111111", "value" : "40" }
 * @param {분할 결과의 두번째 채권 정보} dst2 
 * 
 * @return 오유. 성공한경우 null을 귀환.
 */
var SplitBillcoin = async function(srcID, dst1, dst2){
    try {
        logger.info(">>> SplitBillcoin(", srcID, dst1, dst2, ")");
        var sbcData = {
            src: srcID,
            dst: [dst1, dst2]
        }    
        var dataString = JSON.stringify(sbcData);
        logger.info("data string:\n%s", dataString);
    
        let result = await callInvoke(tokenJim, dealerPeers, 'split', [dataString]);
        console.log('split result: ', result.data);
        return null;
    }
    catch(error){
        logger.error("Issue error:" + error.stack ? error.stack : error);
        return error;
    }
}

/**
 * 지적한 채권들을 판매한다.
 * JSON 실례
 * {
        "seller" : "dddddd",
        "buyer"  : "xxxxxx",
        "ids" : ["44444444", "55555555"]
    }
 * @param {판매자 ID} seller 
 * @param {구매자 ID} buyer 
 * @param {판매하려는 채권의 ID 배열} ids 
 *      ex) ["44444444", "55555555"]
 * 
 * @return 오유. 성공한경우 null을 귀환.
 */
var SellBillcoins = async function(seller, buyer, ids){
    try {
        logger.info(">>> SellBillcoins(", seller, buyer, ids, ")");
        var sbcData = {
            seller: seller,
            buyer: buyer,
            ids: ids
        }    
        var dataString = JSON.stringify(sbcData);
        logger.info("data string:\n%s", dataString);
    
        let result = await callInvoke(tokenJim, dealerPeers, 'sell', [dataString]);
        console.log('sell result: ', result.data);
        return null;
    }
    catch(error){
        logger.error("Sell error:" + error.stack ? error.stack : error);
        return error;
    }
}

/**
 * 지적한 채권들을 해결한다.
 * JSON 실례
 * ["11111111","22222222","33333333","div1111111","div2222222"]
 * @param {해결하려는 채권들} ids 
 *      ex) ["11111111","22222222","33333333","div1111111","div2222222"]
 * 
 * @return 오유. 성공한경우 null을 귀환.
 */
var FreeBillcoins = async function(ids){
    try {
        logger.info(">>> FreeBillcoins(", ids, ")");
        var fbcData = ids;
        var dataString = JSON.stringify(fbcData);
        logger.info("data string:\n%s", dataString);
    
        let result = await callInvoke(tokenJim, dealerPeers, 'free', [dataString]);
        console.log('free result: ', result.data);
        return null;
    }
    catch(error){
        logger.error("Free error:" + error.stack ? error.stack : error);
        return error;
    }
}

/**
 * 지적한 채권들의 정보를 가져온다.
 * JSON 실례
 * ["11111111","22222222","33333333","div1111111","div2222222"]
 * @param {채권 ID배열} ids id들은 모두 문자열이여야 한다.
 *      ex) ["11111111","22222222","33333333","div1111111","div2222222"]
 * 
 * @return 채권정보 map
 *      채권 ID를 키로, 채권정보를 값으로 가지는 map
 *      ex)
            [
                1001:"{"final_date":"2019-01-09T17:01:01.000Z","id":"1001","issuer":"alice","owner":"aaaaaa","state":"0","value":"1000"}",
                1002:"{"final_date":"2019-01-09T17:01:01.000Z","id":"1002","issuer":"alice","owner":"bbbbbb","state":"0","value":"2000"}",
                1003:"{"final_date":"2019-01-09T17:01:01.000Z","id":"1003","issuer":"alice","owner":"cccccc","state":"0","value":"3000"}"
            ]
 */
var CollectBillcoins = async function (ids){
    try {
        logger.info(">>> CollectBillcoins(", ids, ")");
        var cbcData = ids;
        var dataString = JSON.stringify(cbcData);
        logger.info("data string:\n%s", dataString);
    
        let result = await callQuery(tokenJim, dealerPeers[0], 'collect', [dataString]);
        if(!result || !result.data){
            throw new Error("Result is null");
        }
        if(!result.data){
            throw new Error("Result data is empty");
        }
        let ret = {};
        console.log('collect result: ', ret);
        for(var key in result.data){
            ret[key] = JSON.parse(result.data[key]);
        }
        return ret;
    }
    catch(error){
        logger.error("Collect error:" + error.stack ? error.stack : error);
        return null;
    }
}

var ResolveToken = async function (ids){
    if(!tokenJim){
        tokenJim = await getToken('Jim', 'Dealer');
    }
    
    if(!tokenBarry){
        tokenBarry = await getToken('Barry', 'Issuer');
    }

    if(tokenJim && tokenBarry){
        return true;
    }
    else{
        return false;
    }
}


exports.IssueBillcoins = IssueBillcoins;
exports.SplitBillcoin = SplitBillcoin;
exports.SellBillcoins = SellBillcoins;
exports.FreeBillcoins = FreeBillcoins;
exports.CollectBillcoins = CollectBillcoins;
exports.ResolveToken = ResolveToken;

