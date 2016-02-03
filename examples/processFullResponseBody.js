'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err, errorKind) {
  // ctx may be null
  var url = (ctx && ctx.clientToProxyRequest) ? ctx.clientToProxyRequest.url : '';
  console.error(errorKind + ' on ' + url + ':', err);
});

proxy.use(Proxy.gunzip);

proxy.onRequest(function(ctx, callback) {
  var chunks = [];
  ctx.onResponseData(function(ctx, chunk, callback) {
    chunks.push(chunk);
    return callback(null, null); // don't write chunks to client response
  });
  ctx.onResponseEnd(function(ctx, callback) {
    var body = Buffer.concat(chunks);
    if(ctx.serverToProxyResponse.headers['content-type'] && ctx.serverToProxyResponse.headers['content-type'].indexOf('text/html') === 0) {
      body = body.toString().replace(/Lucky/g, 'Sexy');
    }
    ctx.proxyToClientResponse.write(body);
    return callback();
  });
  callback();
});



proxy.listen({ port: port });
console.log('listening on ' + port);
