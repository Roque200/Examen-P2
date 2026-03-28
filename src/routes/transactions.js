const express = require('express')
const axios   = require('axios')
const router  = express.Router()

// Set en memoria para evitar re-propagar transacciones ya vistas
// El compañero NO manda X-Propagated, así que usamos hash de contenido
const txsVistas = new Set()

function claveUnica(tx) {
  const pid  = tx.personaId     || tx.persona_id     || ''
  const iid  = tx.institucionId || tx.institucion_id || ''
  const tit  = tx.tituloObtenido|| tx.titulo_obtenido|| ''
  const fech = tx.fechaFin      || tx.fecha_fin      || ''
  return `${pid}|${iid}|${tit}|${fech}`
}

router.post('/', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const body       = req.body

  // ── Normalizar entrada: acepta camelCase o snake_case ──────────────────
  const datosNormalizados = {
    personaId:      body.personaId      || body.persona_id      || body.personId      || body.person_id,
    institucionId:  body.institucionId  || body.institucion_id  || body.institutionId || body.institution_id,
    programaId:     body.programaId     || body.programa_id     || body.programId     || body.program_id     || null,
    tituloObtenido: body.tituloObtenido || body.titulo_obtenido || body.title         || body.degree,
    fechaFin:       body.fechaFin       || body.fecha_fin       || body.endDate       || body.end_date,
    fechaInicio:    body.fechaInicio    || body.fecha_inicio    || body.startDate     || body.start_date     || null,
    numeroCedula:   body.numeroCedula   || body.numero_cedula   || body.cedula        || body.license        || null,
    tituloTesis:    body.tituloTesis    || body.titulo_tesis    || body.thesis        || null,
    menciones:      body.menciones      || body.mentions        || null,
    firmadoPor:     body.firmadoPor     || body.firmado_por     || body.signedBy      || body.signed_by
                    || body.node_id     || process.env.NODE_ID  || 'nodo-1',
  }

  // ── Validar campos requeridos ──────────────────────────────────────────
  const faltantes = ['personaId','institucionId','tituloObtenido','fechaFin']
    .filter(c => !datosNormalizados[c])

  if (faltantes.length > 0) {
    return res.status(400).json({
      error: `Campos requeridos faltantes: ${faltantes.join(', ')}`,
      camposRecibidos: Object.keys(body),
      nota: 'Acepta camelCase (personaId) o snake_case (persona_id)',
    })
  }

  // ── Agregar transacción local ──────────────────────────────────────────
  const tx = blockchain.agregarTransaccion(datosNormalizados)

  // ── Anti-loop ──────────────────────────────────────────────────────────
  // El compañero NO envía X-Propagated, así que detectamos duplicados
  // por contenido además de por header
  const propagadoHeader = req.headers['x-propagated'] === 'true'
  const clave           = claveUnica(datosNormalizados)
  const yaVista         = txsVistas.has(clave)

  if (!propagadoHeader && !yaVista) {
    txsVistas.add(clave)
    setTimeout(() => txsVistas.delete(clave), 5 * 60 * 1000)

    const nodos = blockchain.getNodos()

    // ── Body en snake_case PURO para el compañero ─────────────────────
    // Su transaccionesController.js valida:
    //   ['persona_id', 'institucion_id', 'titulo_obtenido', 'fecha_fin']
    // Si mandamos solo camelCase, su validación falla con 400.
    const bodySnakeCase = {
      persona_id:      datosNormalizados.personaId,
      institucion_id:  datosNormalizados.institucionId,
      programa_id:     datosNormalizados.programaId,
      titulo_obtenido: datosNormalizados.tituloObtenido,
      fecha_fin:       datosNormalizados.fechaFin,
      fecha_inicio:    datosNormalizados.fechaInicio,
      numero_cedula:   datosNormalizados.numeroCedula,
      titulo_tesis:    datosNormalizados.tituloTesis,
      menciones:       datosNormalizados.menciones,
      firmado_por:     datosNormalizados.firmadoPor,
      node_id:         process.env.NODE_ID || 'nodo-1',
    }

    const propagaciones = nodos.map(nodo =>
      axios.post(`${nodo}/transactions`, bodySnakeCase, {
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