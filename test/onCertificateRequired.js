'use strict';

var port = 8081;
var path = require('path');

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});

proxy.onCertificateRequired = function(hostname, callback) {
  return callback(null, {
    keyFile: path.resolve('/ca/certs/', hostname + '.key'),
    certFile: path.resolve('/ca/certs/', hostname + '.crt')
  });
};

proxy.listen({ port: port });
console.log('listening on ' + port);
