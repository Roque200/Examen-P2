const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * POST /transactions
 *
 * COMPATIBILIDAD COMPLETA:
 * - Acepta campos camelCase (nuestro formato) o snake_case (compañero)
 * - Propaga a todos los peers con body dual (ambos formatos a la vez)
 * - Anti-loop: detecta si la transacción ya viene propagada usando
 *   el header X-Propagated O si el body ya contiene el mismo tx_id
 *
 * IMPORTANTE: el nodo del compañero NO envía X-Propagated al propagar,
 * así que no podemos depender solo de ese header. Usamos un Set en memoria
 * para rastrear transacciones ya vistas por su hash de contenido.
 */

// Set en memoria para evitar re-propagar transacciones ya conocidas
const txsVistas = new Set()

function hashTx(tx) {
  // Clave única basada en los campos de negocio para detectar duplicados
  const persona    = tx.personaId     || tx.persona_id     || ''
  const institucion= tx.institucionId || tx.institucion_id || ''
  const titulo     = tx.tituloObtenido|| tx.titulo_obtenido|| ''
  const fecha      = tx.fechaFin      || tx.fecha_fin      || ''
  return `${persona}|${institucion}|${titulo}|${fecha}`
}

router.post('/', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const body       = req.body

  // ── Normalizar campos de entrada (acepta camelCase o snake_case) ──────────
  const datosNormalizados = {
    personaId:      body.personaId      || body.persona_id      || body.personId     || body.person_id,
    institucionId:  body.institucionId  || body.institucion_id  || body.institutionId|| body.institution_id,
    programaId:     body.programaId     || body.programa_id     || body.programId    || body.program_id    || null,
    tituloObtenido: body.tituloObtenido || body.titulo_obtenido || body.title        || body.degree,
    fechaFin:       body.fechaFin       || body.fecha_fin       || body.endDate      || body.end_date,
    fechaInicio:    body.fechaInicio    || body.fecha_inicio    || body.startDate    || body.start_date    || null,
    numeroCedula:   body.numeroCedula   || body.numero_cedula   || body.cedula       || body.license       || null,
    tituloTesis:    body.tituloTesis    || body.titulo_tesis    || body.thesis       || null,
    menciones:      body.menciones      || body.mentions        || null,
    firmadoPor:     body.firmadoPor     || body.firmado_por     || body.signedBy     || body.signed_by
                    || body.node_id     || process.env.NODE_ID  || 'nodo-1',
  }

  // ── Validar campos requeridos ─────────────────────────────────────────────
  const camposRequeridos = ['personaId', 'institucionId', 'tituloObtenido', 'fechaFin']
  const faltantes = camposRequeridos.filter(c => !datosNormalizados[c])

  if (faltantes.length > 0) {
    return res.status(400).json({
      error: `Campos requeridos faltantes: ${faltantes.join(', ')}`,
      camposRecibidos: Object.keys(body),
      nota: 'Acepta camelCase (personaId) o snake_case (persona_id)',
    })
  }

  // ── Anti-loop: detectar si ya procesamos esta transacción ─────────────────
  // El compañero NO envía X-Propagated, así que usamos hash del contenido
  const propagadoHeader = req.headers['x-propagated'] === 'true'
  const claveUnica      = hashTx(datosNormalizados)
  const yaVista         = txsVistas.has(claveUnica)

  const tx = blockchain.agregarTransaccion(datosNormalizados)

  // ── Propagar solo si NO es re-propagación ─────────────────────────────────
  if (!propagadoHeader && !yaVista) {
    txsVistas.add(claveUnica)
    // Limpiar el Set después de 5 minutos para no crecer indefinidamente
    setTimeout(() => txsVistas.delete(claveUnica), 5 * 60 * 1000)

    const nodos = blockchain.getNodos()

    // Body dual: camelCase + snake_case para que cualquier nodo lo entienda
    const bodyPropagacion = {
      // camelCase (nuestro formato)
      personaId:      datosNormalizados.personaId,
      institucionId:  datosNormalizados.institucionId,
      programaId:     datosNormalizados.programaId,
      tituloObtenido: datosNormalizados.tituloObtenido,
      fechaFin:       datosNormalizados.fechaFin,
      fechaInicio:    datosNormalizados.fechaInicio,
      numeroCedula:   datosNormalizados.numeroCedula,
      tituloTesis:    datosNormalizados.tituloTesis,
      menciones:      datosNormalizados.menciones,
      firmadoPor:     datosNormalizados.firmadoPor,
      // snake_case (formato del compañero)
      persona_id:      datosNormalizados.personaId,
      institucion_id:  datosNormalizados.institucionId,
      programa_id:     datosNormalizados.programaId,
      titulo_obtenido: datosNormalizados.tituloObtenido,
      fecha_fin:       datosNormalizados.fechaFin,
      fecha_inicio:    datosNormalizados.fechaInicio,
      numero_cedula:   datosNormalizados.numeroCedula,
      titulo_tesis:    datosNormalizados.tituloTesis,
      firmado_por:     datosNormalizados.firmadoPor,
      node_id:         process.env.NODE_ID || 'nodo-1',
    }

    const propagaciones = nodos.map(nodo =>
      axios.post(`${nodo}/transactions`, bodyPropagacion, {
        headers: { 'X-Propagated': 'true' },
        timeout: 5000,
      }).catch(err =>
        console.warn(`[Propagacion TX] Fallo ${nodo}: ${err.response?.status} — ${JSON.stringify(err.response?.data)}`)
      )
    )
    await Promise.allSettled(propagaciones)
  }

  res.status(201).json({
    mensaje:      'Transacción agregada',
    transaccion:  tx,
    propagada:    !propagadoHeader && !yaVista,
    indiceBloque: blockchain.chain.length,
  })
})

module.exports = router