'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});

proxy.onRequest(function(ctx, callback) {
  ctx.proxyToClientResponse.end("Hacked, you cannot proceed to the website");
  // no callback() so proxy request is not sent to the server
});

proxy.listen({ port: port });
console.log('listening on ' + port);
