// Envia los mensajes programados cuando llega su hora.
const TICK_MS = 10_000
// Si la PC estaba apagada a la hora de envio, solo mandamos el mensaje si el retraso
// no supera este margen; si no, se marca como "perdido" para no enviar algo fuera de contexto.
const GRACE_S = Number(process.env.SCHEDULE_GRACE_MIN ?? 60) * 60

export const REPEATS = ['none', 'daily', 'weekdays', 'weekly']

// Siguiente ocurrencia (en hora local) despues de `ts` segun la repeticion.
export function nextOccurrence(ts, repeat) {
	const d = new Date(ts * 1000)
	if (repeat === 'daily') d.setDate(d.getDate() + 1)
	else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
	else if (repeat === 'weekdays') {
		do d.setDate(d.getDate() + 1)
		while (d.getDay() === 0 || d.getDay() === 6)
	} else return null
	return Math.floor(d.getTime() / 1000)
}

export class Scheduler {
	constructor({ store, wa, log }) {
		this.store = store
		this.wa = wa
		this.log = log
		this.busy = false
		const db = store.db
		this.q = {
			due: db.prepare(`SELECT * FROM scheduled WHERE status = 'pending' AND send_at <= ? ORDER BY send_at`),
			finish: db.prepare(`UPDATE scheduled SET status = ?, last_error = ? WHERE id = ?`),
			advance: db.prepare(`UPDATE scheduled SET send_at = ?, last_error = ? WHERE id = ?`),
			run: db.prepare(`INSERT INTO scheduled_runs (scheduled_id, chat_name, text, at, status, error) VALUES (?, ?, ?, ?, ?, ?)`),
		}
	}

	start() {
		this.timer = setInterval(() => this.tick(), TICK_MS)
		this.tick()
	}

	stop() {
		clearInterval(this.timer)
	}

	async tick() {
		if (this.busy) return
		this.busy = true
		try {
			const now = Math.floor(Date.now() / 1000)
			for (const row of this.q.due.all(now)) {
				const late = now - row.send_at
				if (late > GRACE_S) {
					this.close(row, 'missed', `No se envio a tiempo (la PC o WhatsApp estaban desconectados ${Math.round(late / 60)} min).`)
					continue
				}
				// Sin conexion esperamos al siguiente tick; si se pasa del margen, quedara como perdido.
				if (this.wa.state !== 'open') continue
				try {
					await this.wa.send(row.chat_jid, row.text)
					this.close(row, 'sent', null)
					this.log(`enviado #${row.id} a ${row.chat_name}`)
				} catch (err) {
					this.close(row, 'failed', err.message)
					this.log(`fallo #${row.id} a ${row.chat_name}: ${err.message}`)
				}
			}
		} catch (err) {
			this.log(`error en el programador: ${err.stack ?? err}`)
		} finally {
			this.busy = false
		}
	}

	// Registra la ejecucion; los repetitivos pasan a su siguiente fecha futura.
	close(row, status, error) {
		const now = Math.floor(Date.now() / 1000)
		this.q.run.run(row.id, row.chat_name, row.text, now, status, error)
		if (row.repeat === 'none') return this.q.finish.run(status, error, row.id)
		let next = nextOccurrence(row.send_at, row.repeat)
		while (next <= now) next = nextOccurrence(next, row.repeat)
		this.q.advance.run(next, error, row.id)
	}
}
