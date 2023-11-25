const port = 8081;
import net from "net";
import assert from "assert";
import { Proxy } from "../";
const proxy = new Proxy();
import { exec } from "child_process";

proxy.onConnect((req, socket, head) => {
  if (!req.url) {
    console.log("No url in request");
    return;
  }
  const host = req.url.split(":")[0];
  const port = parseInt(req.url.split(":")[1]);

  console.log("Tunnel to", req.url);
  const conn = net.connect(
    {
      port,
      host,
      allowHalfOpen: true,
    },
    () => {
      conn.on("finish", () => {
        socket.destroy();
      });
      socket.on("close", () => {
        conn.end();
      });
      socket.write("HTTP/1.1 200 OK\r\n\r\n", "utf-8", () => {
        conn.pipe(socket);
        socket.pipe(conn);
      });
    }
  );

  conn.on("error", (err) => {
    filterSocketConnReset(err, "PROXY_TO_SERVER_SOCKET");
  });
  socket.on("error", (err) => {
    filterSocketConnReset(err, "CLIENT_TO_PROXY_SOCKET");
  });
});

// Since node 0.9.9, ECONNRESET on sockets are no longer hidden
function filterSocketConnReset(err, socketDescription) {
  if (err.errno === "ECONNRESET") {
    console.log(`Got ECONNRESET on ${socketDescription}, ignoring.`);
  } else {
    console.log(`Got unexpected error on ${socketDescription}`, err);
  }
}

proxy.listen({ port }, () => {
  console.log(`Proxy server listening on ${port}`);

  const cmd = `curl -x http://localhost:${port} https://github.com/ | grep html`;
  console.log(`> ${cmd}`);
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    console.log(`${stdout}`);
    assert(/DOCTYPE/.test(stdout));
    proxy.close();
  });
});
