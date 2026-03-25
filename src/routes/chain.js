const express = require('express')
const router  = express.Router()

/**
 * GET /chain
 * Retorna la cadena completa y su longitud
 */
router.get('/', (req, res) => {
  const blockchain = req.app.get('blockchain')

  res.json({
    chain:  blockchain.chain,
    length: blockchain.chain.length,
  })
})

module.exports = router
