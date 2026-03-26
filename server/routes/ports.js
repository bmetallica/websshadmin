const express = require('express');
const { scanPorts } = require('../services/portScanner');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const ports = scanPorts();
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
