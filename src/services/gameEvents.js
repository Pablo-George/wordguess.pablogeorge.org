const EventEmitter = require('events');
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

function publish(channel, data) {
  emitter.emit(channel, data);
}

function subscribe(channel, handler) {
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}

module.exports = { publish, subscribe };
