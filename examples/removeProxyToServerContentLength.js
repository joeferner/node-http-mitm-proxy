'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.onRequest(function(ctx, callback) {
    if('content-length' in ctx.proxyToServerRequestOptions.headers) {
        console.log(`found "content-length" header in request to "${ctx.proxyToServerRequestOptions.host}${ctx.proxyToServerRequestOptions.path}". Removing.`);
        delete ctx.proxyToServerRequestOptions.headers['content-length'];
    }
    callback();
});

proxy.listen({ port: port });
console.log('listening on ' + port);
