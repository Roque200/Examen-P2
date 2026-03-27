const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * POST /transactions
 * Acepta campos en cualquier formato:
 * - español camelCase: personaId, institucionId, programaId, tituloObtenido, fechaFin
 * - inglés camelCase: personId, institutionId, programId, title, endDate
 * - snake_case:       persona_id, institucion_id, programa_id, titulo_obtenido, fecha_fin
 */
router.post('/', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const propagado  = req.headers['x-propagated'] === 'true'

  const body = req.body

  const datosNormalizados = {
    personaId:      body.personaId      || body.personId      || body.persona_id      || body.person_id,
    institucionId:  body.institucionId  || body.institutionId || body.institucion_id  || body.institution_id,
    programaId:     body.programaId     || body.programId     || body.programa_id     || body.program_id,
    tituloObtenido: body.tituloObtenido || body.titulo_obtenido|| body.title          || body.degree,
    fechaFin:       body.fechaFin       || body.fecha_fin     || body.endDate         || body.end_date,
    numeroCedula:   body.numeroCedula   || body.numero_cedula || body.cedula          || body.license  || null,
    tituloTesis:    body.tituloTesis    || body.titulo_tesis  || body.thesis          || null,
    menciones:      body.menciones      || body.mentions      || null,
    firmadoPor:     body.firmadoPor     || body.firmado_por   || body.signedBy        || body.signed_by || body.node_id || process.env.NODE_ID || 'nodo-1',
  }

  const camposRequeridos = ['personaId', 'institucionId', 'programaId', 'tituloObtenido', 'fechaFin']
  const faltantes = camposRequeridos.filter(c => !datosNormalizados[c])

  if (faltantes.length > 0) {
    return res.status(400).json({
      error: `Campos requeridos faltantes: ${faltantes.join(', ')}`,
      camposRecibidos: Object.keys(body),
      nota: 'Se aceptan: personaId/persona_id, institucionId/institucion_id, programaId/programa_id, tituloObtenido/titulo_obtenido, fechaFin/fecha_fin'
    })
  }

  const tx = blockchain.agregarTransaccion(datosNormalizados)

  if (!propagado) {
    const nodos = blockchain.getNodos()
    const propagaciones = nodos.map(nodo =>
      axios.post(`${nodo}/transactions`, req.body, {
        headers: { 'X-Propagated': 'true' }
      }).catch(err => console.warn(`[Propagacion] Fallo nodo ${nodo}: ${err.message}`))
    )
    await Promise.allSettled(propagaciones)
  }

  res.status(201).json({
    mensaje:      'Transacción agregada',
    transaccion:  tx,
    propagada:    !propagado,
    indiceBloque: blockchain.chain.length,
  })
})

module.exports = router