#! /usr/bin/env node --experimental-specifier-resolution=node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import d from "debug";
const debug = d("http-mitm-proxy:bin");
import { Proxy } from "../lib/proxy";
const proxy = new Proxy();

const args = yargs(hideBin(process.argv))
  .alias("h", "help")
  .alias("h", "?")
  .options("port", {
    default: 80,
    describe: "HTTP Port.",
  })
  .alias("p", "port")
  .options("host", {
    describe: "HTTP Listen Interface.",
  }).argv;

if (args.help) {
  yargs.showHelp();
  process.exit(-1);
}

proxy.onError((ctx, err, errorKind) => {
  debug(errorKind, err);
});
proxy.listen(args, (err) => {
  if (err) {
    debug(`Failed to start listening on port ${args.port}`, err);
    process.exit(1);
  }
  debug(`proxy listening on ${args.port}`);
});
