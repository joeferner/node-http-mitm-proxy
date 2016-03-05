
var util = require('util');
var assert = require('assert');
var crypto = require('crypto');
var request = require('request');
var fs = require('fs');
var http = require('http');
var nodeStatic = require('node-static');
var Proxy = require('../');
var fileStaticA = new nodeStatic.Server(__dirname + '/wwwA');
var fileStaticB = new nodeStatic.Server(__dirname + '/wwwB');
var testHost = '127.0.0.1';
var testHostName = 'localhost';
var testPortA = 40005;
var testPortB = 40006;
var testProxyPort = 40010;
var testUrlA = 'http://' + testHost + ':' + testPortA;
var testUrlB = 'http://' + testHost + ':' + testPortB;

var getHttp = function (url, cb) {
  request({ url: url }, function (err, resp, body) {
    cb(err, resp, body);
  });
};

var proxyHttp = function (url, cb) {
  request({ url: url, proxy: 'http://127.0.0.1:' + testProxyPort, ca: fs.readFileSync(__dirname + '/../.http-mitm-proxy/certs/ca.pem') }, function (err, resp, body) {
	cb(err, resp, body);
  });
};

var countString = function (str, substr, cb) {
  var pos = str.indexOf(substr);
  var len = substr.length;
  var count = 0;
  if (pos > -1) {
    var offSet = len;
    while(pos !== -1) {
      count++;
      offSet = pos + len;
      pos = str.indexOf(substr, offSet);
    }
  }
  cb(count);
};

describe('proxy', function () {
  var srvA = null;
  var srvB = null;
  var proxy = null;
  var testHashes = {};
  var testFiles = [
    '1024'
  ];
  before(function () {
    testFiles.forEach(function (val) {
      testHashes[val] = crypto.createHash('sha256').update(fs.readFileSync(__dirname + '/www/' + val, 'utf8'), 'utf8').digest().toString();
    });
    srvA = http.createServer(function (req, res) {
      req.addListener('end', function () {
        fileStaticA.serve(req, res);
      }).resume();
    });
    srvA.listen(testPortA, testHost);
    srvB = http.createServer(function (req, res) {
      req.addListener('end', function () {
        fileStaticB.serve(req, res);
      }).resume();
    });
    srvB.listen(testPortB, testHost);
  });
  
  beforeEach(function (done) {
    proxy = new Proxy();
    proxy.listen({ port: testProxyPort, silent: true }, done);
  });
  
  afterEach(function () {
    proxy.close();
    proxy = null;
  });
  
  after(function () {
    srvA.close();
    srvA = null;
    srvB.close();
    srvB = null;
  });
  
  describe('ca server', function () {
    it('should generate a root CA file', function (done) {
      fs.access(__dirname + '/../.http-mitm-proxy/certs/ca.pem', function (err) {
        var rtv = null;
        if (err) {
          rtv = __dirname + '/../.http-mitm-proxy/certs/ca.pem ' + err;
        } else {
          rtv = true;
        }
        assert.equal(true, rtv, 'Can access the CA cert');
        done();
      });
    });
  });
  
  describe('http server', function () {
    describe('get a 1024 byte file', function () {
      it('a', function (done) {
        getHttp(testUrlA + '/1024', function (err, resp, body) {
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len, 'body length is 1024');
          assert.equal(testHashes['1024'], crypto.createHash('sha256').update(body, 'utf8').digest().toString(), 'sha256 hash matches');
          done();
        });
      });
      it('b', function (done) {
        getHttp(testUrlB + '/1024', function (err, resp, body) {
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len, 'body length is 1024');
          assert.equal(testHashes['1024'], crypto.createHash('sha256').update(body, 'utf8').digest().toString(), 'sha256 hash matches');
          done();
        });
      });
    });
  });
  
  describe('proxy server', function () {
    this.timeout(5000);
    describe('proxy a 1024 byte file', function () {
      it('a', function (done) {
        proxyHttp(testUrlA + '/1024', function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(testHashes['1024'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      });
      it('b', function (done) {
        proxyHttp(testUrlB + '/1024', function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(testHashes['1024'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      });
    });
    describe('ssl', function () {
      it('proxys to google.com using local ca file', function (done) {
        proxyHttp('https://www.google.com/', function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          assert.equal(200, resp.statusCode, '200 Status code from Google.');
          done();
        });
      });
    });
    describe('host match', function () {
      it('proxy and modify AAA 5 times if hostA', function (done) {
        proxy.onRequest(function (ctx, callback) {
          // console.log(ctx.clientToProxyRequest.headers);
          var testHostNameA = '127.0.0.1:' + testPortA;
          if (ctx.clientToProxyRequest.headers.host === testHostNameA) {
            var chunks = [];
            ctx.onResponseData(function (ctx, chunk, callback) {
              chunks.push(chunk);
              return callback(null, null);
            });
            ctx.onResponseEnd(function (ctx, callback) {
              var body = (Buffer.concat(chunks)).toString();
              for(var i = 0; i < 5; i++) {
                var off = (i * 10);
                body = body.substr(0, off) + 'AAA' + body.substr(off + 3);
              }
              ctx.proxyToClientResponse.write(body);
              return callback();
            });
          }
          return callback();
        });
      
        proxyHttp(testUrlA + '/1024', function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          countString(body, 'AAA', function (count) {
            assert.equal(5, count);
            proxyHttp(testUrlB + '/1024', function (errB, respB, bodyB) {
              if (errB) console.log('errB: ' + errB.toString());
              var lenB = 0;
              if (bodyB.hasOwnProperty('length')) lenB = bodyB.length;
              assert.equal(1024, lenB);
              countString(bodyB, 'AAA', function (countB) {
                assert.equal(0, countB);
                done();
              });
            });
          });
        });
      });
    });
  });
  
});