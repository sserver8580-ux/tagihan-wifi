// api/index.js - Vercel Serverless Function Handler
const server = require('../server.js');

module.exports = (req, res) => {
  server.emit('request', req, res);
};

