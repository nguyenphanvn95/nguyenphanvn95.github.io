/**
 * xiangqi_engine.js - Pikafish WASM worker adapter
 *
 * Wraps the browser build of Pikafish behind the same Worker message contract
 * used by the rest of the extension.
 */
'use strict';

const boot = self.__XQ_ENGINE_BOOT__ || {};
const loaderUrl = boot.loaderUrl || self.location?.href || '';
const localPikafishUrl = loaderUrl
  ? new URL('pikafish.js', loaderUrl).toString()
  : 'pikafish.js';

let commandQueue = [];
let engine = null;
let engineReady = false;
let booting = false;

function emit(line) {
  self.postMessage(String(line));
}

function debug(message) {
  emit(`info string [loader] ${message}`);
}

function queueCommand(command) {
  commandQueue.push(command);
}

function replayQueuedCommands(send) {
  const queued = commandQueue;
  commandQueue = [];
  for (const command of queued) {
    send(command);
  }
}

function getBaseUrl(scriptUrl) {
  return scriptUrl.slice(0, scriptUrl.lastIndexOf('/') + 1);
}

async function loadPikafish(scriptUrl) {
  debug(`loading pikafish engine from ${scriptUrl}`);
  importScripts(scriptUrl);

  if (typeof self.Pikafish !== 'function') {
    throw new Error('Pikafish factory missing after importScripts');
  }

  const baseUrl = getBaseUrl(scriptUrl);
  const instance = await self.Pikafish({
    locateFile(file) {
      return baseUrl + file;
    },
    noInitialRun: true,
    read_stdout(line) {
      emit(line);
    },
    print(line) {
      emit(line);
    },
    printErr(line) {
      emit(`info string [pikafish-stderr] ${line}`);
    },
  });

  if (typeof instance?.send_command !== 'function') {
    throw new Error('Pikafish instance does not expose send_command');
  }

  engine = instance;
  engineReady = true;

  debug('pikafish engine ready');
  emit('info string engine loaded (Pikafish 4.0)');

  replayQueuedCommands(command => engine.send_command(command));
}

async function bootEngine() {
  if (booting || engineReady) return;
  booting = true;

  try {
    await loadPikafish(localPikafishUrl);
  } catch (err) {
    emit(`info string [loader] engine failed to load: ${err && err.message ? err.message : err}`);
  }
}

self.onmessage = function onLoaderMessage(event) {
  const command = typeof event.data === 'string' ? event.data : String(event.data || '');
  if (!command) return;

  if (!booting && !engineReady) {
    bootEngine();
  }

  if (!engineReady) {
    queueCommand(command);
    return;
  }

  engine.send_command(command);
};

bootEngine();
