'use strict';

var port = 8081;
var net = require('net');
var assert = require('assert');
var Proxy = require('../');
var proxy = Proxy();

proxy.onConnect(function(req, socket, head) {
  var host = req.url.split(":")[0];
  var port = req.url.split(":")[1];

  console.log('Tunnel to', req.url);
  var conn = net.connect({
    port: port,
    host: host,
    allowHalfOpen: true
  }, function(){
    conn.on('finish', () => {
      socket.destroy();
    });
    socket.on('close', () => {
      conn.end();
    });
    socket.write('HTTP/1.1 200 OK\r\n\r\n', 'UTF-8', function(){
      conn.pipe(socket);
      socket.pipe(conn);
    })
  });

  conn.on('error', function(err) {
    filterSocketConnReset(err, 'PROXY_TO_SERVER_SOCKET');
  });
  socket.on('error', function(err) {
    filterSocketConnReset(err, 'CLIENT_TO_PROXY_SOCKET');
  });
});

// Since node 0.9.9, ECONNRESET on sockets are no longer hidden
function filterSocketConnReset(err, socketDescription) {
  if (err.errno === 'ECONNRESET') {
    console.log('Got ECONNRESET on ' + socketDescription + ', ignoring.');
  } else {
    console.log('Got unexpected error on ' + socketDescription, err);
  }
}

proxy.listen({ port }, function() {
  console.log('Proxy server listening on ' + port);

  var cmd = `curl -x http://localhost:${port} https://github.com/ | grep html`;
  console.log('> ' + cmd);
  require('child_process').exec(cmd, function (error, stdout, stderr) {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    console.log(`${stdout}`);
    assert(/DOCTYPE/.test(stdout));
    proxy.close();
  });
});
