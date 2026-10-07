'use strict';

function createSseHandler(statusBus) {
  return (req, res) => {
    const junctionId = req.params.id;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const listener = (state) => {
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    };

    statusBus.subscribe(junctionId, listener);

    req.on('close', () => {
      statusBus.unsubscribe(junctionId, listener);
    });
  };
}

module.exports = { createSseHandler };
