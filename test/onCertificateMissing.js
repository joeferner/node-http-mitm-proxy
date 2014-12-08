'use strict';

var port = 8081;
var path = require('path');

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});

proxy.onCertificateMissing = function(ctx, files, callback) {
  console.log('Looking for "%s" certificates', ctx.hostname);
  console.log('"%s" missing', ctx.files.keyFile);
  console.log('"%s" missing', ctx.files.certFile);

  // Here you have the last chance to provide certificate files data
  // A tipical use case would be creating them on the fly
  //
  // return callback(null, {
  //   key: keyFileData,
  //   cert: certFileData
  // });
};

proxy.listen({ port: port });
console.log('listening on ' + port);
