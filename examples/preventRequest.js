'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err, errorKind) {
  // ctx may be null
  var url = (ctx && ctx.clientToProxyRequest) ? ctx.clientToProxyRequest.url : '';
  console.error(errorKind + ' on ' + url + ':', err);
});

proxy.onRequest(function(ctx, callback) {
  ctx.proxyToClientResponse.end('Hacked, you cannot proceed to the website');
  // no callback() so proxy request is not sent to the server
});

proxy.listen({ port: port });
console.log('listening on ' + port);
