// Datos de ejemplo al instante: Claude describe las columnas ("50 clientes con nombre, ciudad y correo") y aqui se
// generan las filas. Escribir cientos de filas a mano le tomaba a la IA mas de 7 minutos; asi tarda milisegundos.
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const int = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const NOMBRES = ['Lidia', 'Carlos', 'Ana', 'Jorge', 'Sofía', 'Diego', 'María', 'José', 'Fernanda', 'Luis', 'Valeria', 'Miguel', 'Camila', 'Andrés', 'Daniela', 'Ricardo', 'Paola', 'Javier', 'Gabriela', 'Roberto', 'Mariana', 'Alejandro', 'Lucía', 'Fernando', 'Isabel', 'Héctor', 'Patricia', 'Raúl', 'Elena', 'Óscar', 'Natalia', 'Arturo', 'Carmen', 'Emilio', 'Teresa', 'Víctor', 'Adriana', 'Pablo', 'Rosa', 'Manuel']
const APELLIDOS = ['Pérez', 'Méndez', 'Torres', 'Salas', 'León', 'Mora', 'García', 'Hernández', 'López', 'Martínez', 'González', 'Rodríguez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Gómez', 'Díaz', 'Reyes', 'Morales', 'Jiménez', 'Ruiz', 'Vargas', 'Castillo', 'Ortiz', 'Romero', 'Navarro', 'Medina', 'Aguilar', 'Herrera']
const CIUDADES = ['Ciudad de México', 'Monterrey', 'Guadalajara', 'Puebla', 'Querétaro', 'Mérida', 'Tijuana', 'León', 'Saltillo', 'Toluca', 'Chihuahua', 'Morelia', 'Hermosillo', 'Aguascalientes', 'Cancún', 'Oaxaca', 'Veracruz', 'Culiacán']
const EMPRESA_A = ['Comercial', 'Distribuidora', 'Grupo', 'Servicios', 'Abarrotes', 'Ferretería', 'Constructora', 'Papelería', 'Farmacia', 'Logística']
const EMPRESA_B = ['del Norte', 'Azteca', 'San José', 'La Esperanza', 'Central', 'del Valle', 'Las Palmas', 'Omega', 'Horizonte', 'El Sol', 'Pacífico', 'Monarca']
const PRODUCTOS = {
	Abarrotes: ['Arroz 1 kg', 'Frijol negro 1 kg', 'Aceite 1 L', 'Azúcar 2 kg', 'Café molido 500 g', 'Atún en lata', 'Pasta 500 g', 'Harina 1 kg', 'Leche 1 L', 'Galletas surtidas'],
	Limpieza: ['Detergente 1 kg', 'Cloro 1 L', 'Jabón de barra', 'Suavizante 1 L', 'Limpiador multiusos', 'Esponjas x3', 'Papel higiénico x12', 'Escoba', 'Trapeador', 'Bolsas de basura'],
	Ferretería: ['Cemento 50 kg', 'Varilla 3/8', 'Clavos 1 kg', 'Pintura vinílica 4 L', 'Tornillos x100', 'Martillo', 'Desarmador', 'Cinta métrica', 'Taladro', 'Brocha 2"'],
	Papelería: ['Cuaderno profesional', 'Pluma azul', 'Lápiz HB', 'Resma de hojas', 'Marcatextos', 'Folder tamaño carta', 'Engrapadora', 'Tijeras', 'Pegamento', 'Calculadora'],
	Electrónica: ['Audífonos', 'Cargador USB-C', 'Mouse inalámbrico', 'Teclado', 'Memoria USB 64 GB', 'Bocina Bluetooth', 'Cable HDMI', 'Power bank', 'Foco LED', 'Extensión eléctrica'],
}
const CATEGORIAS = Object.keys(PRODUCTOS)

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Un generador por tipo de columna. ctx = { row, rowData, sheets } para referencias entre pestañas.
const GEN = {
	id: (c, ctx) => (c.inicio ?? 1) + ctx.index,
	folio: (c, ctx) => { const p = String(c.prefijo ?? 'F'); return `${p}${/[-_ ]$/.test(p) ? '' : '-'}${String((c.inicio ?? 1) + ctx.index).padStart(4, '0')}` },
	nombre: () => `${pick(NOMBRES)} ${pick(APELLIDOS)}`,
	empresa: () => `${pick(EMPRESA_A)} ${pick(EMPRESA_B)}`,
	email: (c, ctx) => {
		const base = Object.values(ctx.rowData).find((v) => typeof v === 'string' && /^\p{L}+ \p{L}+/u.test(v)) ?? `${pick(NOMBRES)} ${pick(APELLIDOS)}`
		return `${fold(base).replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}${int(1, 99)}@${c.dominio ?? pick(['gmail.com', 'outlook.com', 'yahoo.com.mx', 'empresa.mx'])}`
	},
	telefono: () => `55 ${int(1000, 9999)} ${int(1000, 9999)}`,
	ciudad: () => pick(CIUDADES),
	categoria: () => pick(CATEGORIAS),
	// Si la fila ya tiene categoria, un producto de esa categoria; si no, productos distintos en orden (50) y luego variantes.
	producto: (c, ctx) => {
		const cat = Object.values(ctx.rowData).find((v) => CATEGORIAS.includes(v))
		if (cat) return pick(PRODUCTOS[cat])
		const all = Object.values(PRODUCTOS).flat()
		return ctx.index < all.length ? all[ctx.index] : `${all[ctx.index % all.length]} modelo ${Math.floor(ctx.index / all.length) + 1}`
	},
	precio: (c) => (Math.round((Math.random() * ((c.max ?? 1500) - (c.min ?? 10)) + (c.min ?? 10)) * 100) / 100).toFixed(2),
	numero: (c) => {
		const v = Math.random() * ((c.max ?? 100) - (c.min ?? 0)) + (c.min ?? 0)
		return c.decimales ? v.toFixed(c.decimales) : String(Math.round(v))
	},
	entero: (c) => String(int(c.min ?? 1, c.max ?? 100)),
	cantidad: (c) => String(int(c.min ?? 1, c.max ?? 20)),
	fecha: (c) => {
		const from = Date.parse(c.desde ?? `${new Date().getFullYear()}-01-01`)
		const to = Date.parse(c.hasta ?? isoDate(new Date()))
		return isoDate(new Date(from + Math.random() * Math.max(0, to - from)))
	},
	opcion: (c) => String(pick(c.valores?.length ? c.valores : ['Sí', 'No'])),
	texto: (c) => String(c.valor ?? ''),
	// Valor al azar de una columna de otra pestaña (p. ej. el Id de un cliente).
	ref: (c, ctx) => {
		const sh = ctx.sheets.find((s) => fold(s.name) === fold(String(c.hoja ?? '')))
		if (!sh) throw new Error(`La columna "${c.name}" se refiere a la pestaña "${c.hoja}", que no existe o va después.`)
		const ci = sh.rows[0].findIndex((h) => fold(String(h)) === fold(String(c.columna ?? '')))
		if (ci < 0) throw new Error(`La pestaña "${c.hoja}" no tiene la columna "${c.columna}".`)
		return pick(sh.rows.slice(1)).at(ci)
	},
	// Formula con {row} = numero de fila de Excel (p. ej. "=D{row}*E{row}").
	formula: (c, ctx) => String(c.formula ?? '').replace(/\{row\}/g, String(ctx.row)),
}
export const SAMPLE_TYPES = Object.keys(GEN)

// tab = { name, count, columns: [{ name, type, ...opciones }], footer?: [...] } -> filas con encabezado.
// En footer, {last} es la ultima fila de datos (p. ej. "=SUM(F2:F{last})").
export function generateRows(tab, sheets) {
	const count = Math.min(Math.max(Number(tab.count) || 10, 1), 5000)
	const cols = tab.columns ?? []
	if (!cols.length) throw new Error(`La pestaña "${tab.name}" no tiene columnas.`)
	for (const c of cols) if (!GEN[c.type]) throw new Error(`Tipo de columna no válido: "${c.type}". Usa: ${SAMPLE_TYPES.join(', ')}.`)
	const rows = [cols.map((c) => c.name)]
	// Se generan primero las columnas de las que dependen otras (la categoria antes que el producto, el nombre antes
	// que el correo), pero quedan en el orden pedido.
	const FIRST = ['categoria', 'nombre', 'empresa']
	const order = cols.map((c, i) => i).sort((a, b) => (FIRST.includes(cols[b].type) ? 1 : 0) - (FIRST.includes(cols[a].type) ? 1 : 0))
	for (let i = 0; i < count; i++) {
		const rowData = {}
		const ctx = { index: i, row: i + 2, rowData, sheets }
		const row = new Array(cols.length)
		for (const ci of order) row[ci] = rowData[cols[ci].name] = GEN[cols[ci].type](cols[ci], ctx)
		rows.push(row)
	}
	if (Array.isArray(tab.footer) && tab.footer.length) rows.push(tab.footer.map((v) => String(v ?? '').replace(/\{last\}/g, String(count + 1))))
	return rows
}
