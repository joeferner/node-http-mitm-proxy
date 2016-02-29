'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.use(Proxy.wildcard);

proxy.onError(function(ctx, err, errorKind) {
  // ctx may be null
  var url = (ctx && ctx.clientToProxyRequest) ? ctx.clientToProxyRequest.url : '';
  console.error(errorKind + ' on ' + url + ':', err);
});

proxy.listen({ port: port });
console.log('listening on ' + port);
