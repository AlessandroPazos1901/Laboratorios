# Plan de finalización del sistema del laboratorio

Fecha de actualización: 24 de julio de 2026  
Estado: alcance funcional confirmado por el cliente  

> Decisión vigente (2 de agosto de 2026): los registros no tienen estado. Se
> guardan y permanecen editables; imprimir es opcional, no cambia datos y no
> produce métricas ni eventos de impresión. Esta decisión reemplaza cualquier
> referencia anterior a estados o seguimiento de impresiones en este documento.
Objetivo: reemplazar el Excel por una aplicación sencilla para registrar pacientes, análisis y resultados, imprimirlos y consultar estadísticas.

## 1. Alcance confirmado

El sistema será utilizado inicialmente por tres administradores del laboratorio. Los tres tendrán exactamente las mismas facultades. No existirán roles clínicos, aprobación por una segunda persona, MFA ni portal para pacientes.

El circuito principal será:

```text
Buscar DNI
   |
   +-- paciente existente ----+
   |                          |
   +-- registrar nombre+DNI --+
                              v
                    Crear registro de análisis
                              |
                              v
                     Ingresar resultados
                              |
                              v
                        Guardar cambios
                              |
                              v
                      Imprimir resultado
```

Decisiones confirmadas:

- solo se acepta DNI;
- los datos maestros del paciente son nombre y DNI;
- un DNI repetido representa al mismo paciente con uno o más análisis, incluso el mismo día;
- no se envían resultados a validación;
- no hay autorizadores ni permisos diferentes entre los tres usuarios;
- cualquier usuario autorizado puede registrar o corregir;
- un valor crítico muestra una advertencia pequeña y visible, pero no bloquea el guardado ni la impresión;
- la fecha y hora se completan con el momento actual y pueden editarse;
- no se conserva un código de muestra;
- el informe se imprime en tamaño Carta y el especialista coloca sello y firma manualmente;
- el sistema no envía informes por correo, WhatsApp u otro medio;
- el PDF se genera para visualizar o imprimir y no se almacena como documento;
- no se mide tiempo de respuesta;
- las estadísticas principales muestran cuántos análisis se hicieron y de qué tipo;
- se puede exportar a Excel la información de pacientes, análisis y resultados;
- no se migrará todo el histórico: se cargará una muestra de 20 pacientes reales del libro;
- no se conservará un número de fila del Excel visible en la aplicación;
- no habrá facturación, inventario, integración con equipos, portal del paciente, Drive ni IA.

## 2. Estado real de la aplicación

La aplicación ya dispone de login con Supabase, base de datos, RLS, navegación y diseño visual. No obstante, todavía mezcla pantallas reales con comportamientos de demostración.

| Área | Estado actual | Trabajo pendiente |
|---|---|---|
| Login | Funciona | Mejorar errores, sesiones y probar tres cuentas |
| Inicio | Parcial | Sustituir gráficas y fechas fijas por consultas reales |
| Resultados | Solo lectura local | Crear registros y guardar resultados en Supabase |
| Pacientes | Solo lectura | Buscar, crear, editar y abrir historial |
| Estadísticas | Maqueta | Filtros y comparaciones reales |
| Catálogo | Solo lectura | Cargar estructura del Excel y permitir mantenimiento |
| Importaciones | Vista previa | Importar pacientes y cargar muestra inicial |
| Configuración | Maqueta | Simplificar a identidad de impresión y cuentas activas |
| Impresión | Solo demo | Generar informe real desde Supabase |

La prioridad es completar el recorrido operativo. Ninguna acción visible debe quedar sin efecto.

## 3. Principios de facilidad de uso

1. **DNI como punto de entrada.** La búsqueda por DNI estará siempre disponible y tendrá foco automático en los flujos de registro.
2. **Pocas pantallas.** Registrar un análisis no abrirá una sucesión de ventanas; se usará un flujo corto con selección, captura y guardado.
3. **Paneles frecuentes primero.** Los análisis más usados, determinados desde el Excel, aparecerán antes que el catálogo completo.
4. **Teclado eficiente.** Enter avanza al siguiente resultado y `Ctrl+S` guarda.
5. **Guardado inequívoco.** La interfaz mostrará “Guardando”, “Guardado” o un error claro; nunca simulará que guardó.
6. **Edición directa y auditable.** Un usuario puede corregir, pero debe indicar un motivo breve cuando ya existía un resultado impreso.
7. **Advertencias discretas.** Bajo, alto y crítico se muestran con texto, icono y color sin impedir el trabajo.
8. **Sin datos innecesarios.** No se pedirán RUC, dirección del paciente, correo, nacimiento o sexo si el flujo confirmado solo necesita nombre y DNI.
9. **Responsive real.** Escritorio será la experiencia principal, pero registro, consulta e impresión se adaptarán a tablet y móvil.
10. **Escalable por consulta.** Pacientes y resultados se buscan y paginan en Supabase; no se carga toda la base en el navegador.

## 4. Modelo funcional simplificado

### Usuarios

- correo;
- contraseña;
- nombre visible;
- activo/inactivo;
- todos los usuarios activos poseen las mismas facultades.

La columna de rol existente se conserva internamente, pero no se muestra. Cada una de las tres cuentas autorizadas se marca explícitamente como `owner`, reutilizando las políticas RLS restrictivas; los usuarios futuros no reciben administración automática.

### Pacientes

- UUID interno;
- DNI de ocho dígitos, único;
- nombre completo;
- fecha de creación y actualización;
- usuario que creó y usuario que modificó.

La aplicación no creará otro paciente al encontrar el mismo DNI. Abrirá su ficha y permitirá registrar nuevos análisis.

### Registros de análisis

Cada registro agrupa:

- paciente;
- fecha y hora, actual por defecto y editable;
- análisis o paneles seleccionados;
- tipo y condición de muestra cuando corresponda;
- resultados;
- observaciones;
- usuario creador y último editor.

No habrá estados, validación ni acción “validar”.

### Resultados y revisiones

- numérico, cualitativo o texto;
- unidad y rango tomados de la versión del catálogo;
- bandera normal, baja, alta o crítica;
- historial de modificaciones;
- edición posterior conservando el historial de modificaciones.

Los informes no se almacenan. Al imprimir se genera el documento desde los
datos vigentes sin modificar el registro ni guardar un evento de impresión.

### Catálogo

- grupos;
- análisis;
- paneles;
- tipo de resultado;
- muestra;
- método cuando esté definido en el Excel;
- unidad;
- decimales;
- opciones cualitativas;
- referencias;
- límites críticos;
- activo/inactivo.

La fuente inicial será `REGISTRO DIARIO 2026 (version 1).xlsb.xlsm`. No se copiarán fórmulas rotas ni se asumirán como reglas clínicas encabezados ambiguos.

## 5. Arquitectura

```text
Navegador
   |
   v
Next.js
  - componentes por sección
  - acciones tipadas
  - impresión Carta bajo demanda
   |
   v
Supabase
  - Auth
  - PostgreSQL + RLS
  - RPC transaccionales
```

Se mantiene Next.js + Supabase sin Prisma, microservicios, Redis ni API pública.

Cambios técnicos necesarios:

- dividir `lab-app.tsx` por función;
- generar tipos TypeScript desde Supabase;
- retirar los datos demo de ambientes conectados;
- crear consultas paginadas;
- adaptar el esquema y RPC al flujo sin validación;
- no utilizar `report_versions` ni Storage para el flujo habitual de impresión;
- conservar migraciones existentes y añadir una migración nueva, sin reescribir las ya aplicadas;
- traducir errores SQL a mensajes claros en español.

## 6. Plan de implementación

### Fase 1 — Alinear base de datos con el flujo real

Tareas:

- crear una nueva migración que haga equivalentes a todos los usuarios activos;
- retirar estados y transiciones del flujo funcional;
- guardar cada registro directamente sin validación;
- permitir impresión no bloqueante cuando los resultados estén completos;
- permitir correcciones directas con trazabilidad de cambios;
- convertir los valores críticos en advertencia, no condición de bloqueo;
- generar la impresión sin almacenar PDF ni registrar una métrica;
- simplificar pacientes a DNI y nombre obligatorio;
- definir índices para DNI, fecha, grupo y análisis;
- retirar del frontend el lenguaje de validación, entrega y tiempo de respuesta.

Criterios de aceptación:

- los tres usuarios activos pueden realizar las mismas operaciones;
- un crítico se guarda y muestra advertencia;
- una corrección conserva usuario, fecha, valor anterior, nuevo y motivo;
- las migraciones 001–004 permanecen intactas y la nueva migración se aplica encima.

### Fase 2 — Extraer y preparar el catálogo del Excel

Tareas:

- inventariar hojas y plantillas;
- identificar grupos, análisis y paneles;
- extraer unidad, método, decimales, opciones y rangos existentes;
- detectar los análisis más frecuentes;
- separar títulos, fórmulas auxiliares y datos clínicos reales;
- crear un catálogo normalizado revisable;
- identificar ambigüedades sin inventar reglas;
- crear un seed idempotente del catálogo;
- seleccionar 20 pacientes distintos por DNI;
- incluir para la muestra algunos pacientes con varios análisis y fechas;
- anonimizar únicamente las evidencias técnicas, pero cargar la muestra real solo en el proyecto privado autorizado.

Criterios de aceptación:

- cada análisis del seed tiene una procedencia identificable en el libro;
- no existen duplicados de análisis por diferencias de mayúsculas o espacios;
- los cinco análisis o paneles más frecuentes quedan identificados;
- la carga de 20 pacientes puede ejecutarse dos veces sin duplicar.

Bloqueo actual: el entorno de esta sesión no expone la herramienta autorizada para abrir el libro y no hay una sesión de Excel conectada. No se utilizará una librería alternativa para interpretar datos clínicos. La extracción continuará cuando el libro se abra en una sesión de Excel conectada o esté disponible el runtime de Spreadsheets.

### Fase 3 — Pacientes y búsqueda

Tareas:

- búsqueda global real por DNI, nombre y registro;
- foco y búsqueda inmediata por DNI;
- formulario corto: DNI y nombre completo;
- creación mediante RPC idempotente;
- edición del nombre;
- ficha con registros cronológicos;
- acceso directo a “Nuevo análisis” desde la ficha;
- paginación y estados vacíos;
- impedir DNI duplicado en UI y servidor.

Criterios de aceptación:

- un DNI existente abre el mismo paciente;
- registrar el mismo DNI nunca crea otra fila;
- buscar y comenzar un análisis requiere como máximo tres acciones;
- la ficha funciona con muchos registros sin cargar toda la base.

### Fase 4 — Catálogo administrable

Tareas:

- listar y filtrar grupos, análisis y paneles;
- alta y edición simple;
- editor según tipo de resultado;
- campos opcionales para método y muestra;
- rangos y críticos configurables;
- archivado en lugar de eliminación;
- paneles frecuentes en primer lugar;
- validaciones de duplicados y valores incompletos;

Criterios de aceptación:

- un análisis nuevo aparece inmediatamente en el registro;
- un análisis usado previamente no puede eliminarse;
- cambiar unidad o rango no altera resultados históricos;
- cualquier usuario activo puede administrar el catálogo.

### Fase 5 — Registro de análisis y resultados

Flujo:

1. buscar o registrar DNI;
2. confirmar nombre;
3. elegir paneles o análisis;
4. establecer fecha/hora;
5. registrar datos de muestra que correspondan;
6. crear el registro;
7. ingresar resultados;
8. guardar;
9. imprimir cuando se necesite.

Tareas:

- implementar “Nuevo análisis” desde cabecera, paciente y Resultados;
- mostrar favoritos/frecuentes;
- evitar seleccionar dos veces el mismo análisis;
- usar controles numéricos, cualitativos y textuales apropiados;
- guardar con RPC y control de concurrencia;
- autosave con espera breve, además de `Ctrl+S`;
- indicar resultados pendientes sin crear un flujo de validación;
- advertir si se intenta imprimir con resultados vacíos y permitir volver a completar;
- mostrar bajo, alto y crítico sin bloquear;
- permitir observaciones;
- permitir anulación con motivo;
- actualizar la cola sin recargar la página.

Criterios de aceptación:

- recargar conserva todos los resultados guardados;
- doble clic no duplica el registro;
- el sistema recupera un conflicto de dos usuarios sin sobrescribir;
- el recorrido funciona por teclado;
- una orden con valor crítico puede guardarse e imprimirse mostrando la advertencia.

### Fase 6 — Edición

Tareas:

- edición directa de resultados;
- guardar directamente el valor vigente;
- mostrar quién realizó cada análisis.

Criterios de aceptación:

- los resultados guardados vuelven a cargarse correctamente;
- cualquier resultado puede corregirse y guardarse de nuevo.

### Fase 7 — Informe Carta e impresión

Tareas:

- generar el informe real desde Supabase;
- tamaño Carta;
- nombre del laboratorio configurable, sin exigir RUC;
- datos del paciente: nombre y DNI;
- fecha/hora del registro;
- resultados agrupados como en las plantillas del Excel;
- resultado, unidad, referencia y bandera;
- espacio suficiente para sello y firma manual;
- pie configurable;
- salto de página y encabezados repetidos;
- vista previa y botón Imprimir;
- descarga PDF como facilidad secundaria;
- no guardar el archivo ni enviarlo por ningún canal;

Criterios de aceptación:

- todos los grupos se imprimen correctamente;
- ninguna fila queda cortada;
- nombres largos y resultados textuales son legibles;
- no aparecen datos ficticios;
- el especialista puede sellar y firmar en el área prevista.

### Fase 8 — Resultados

Tareas:

- cola por fecha;
- filtros: hoy, rango, DNI, nombre, grupo y análisis;
- ordenar los registros por fecha;
- contadores reales;
- acción rápida para continuar captura;
- acción rápida para imprimir;
- diseño denso para escritorio y tarjetas adaptadas a móvil.

Criterios de aceptación:

- una jornada de más de 20 registros se gestiona sin ralentización;
- los filtros funcionan en servidor;
- no hay contadores ni fechas codificados en el frontend.

### Fase 9 — Estadísticas y comparaciones

Indicadores:

- cantidad de registros;
- cantidad total de análisis;
- pacientes distintos;
- cantidad por grupo;
- cantidad por análisis;
- análisis más frecuentes;
- resultados registrados por usuario;
- tandas y resultados registrados.

Filtros:

- fecha desde/hasta;
- comparación con periodo anterior equivalente;
- grupo;
- análisis;
- usuario.

Tareas:

- RPC agregadas;
- tarjetas y gráficas con datos reales;
- comparación indicando las fechas exactas;
- tabla ordenable de análisis;
- acceso desde una barra/gráfica a los registros que la componen;
- exportación de la vista estadística.

Criterios de aceptación:

- cada métrica coincide con una consulta SQL independiente;
- pacientes, registros y análisis se distinguen claramente;
- no se calculan métricas sobre una lista parcial del navegador.

### Fase 10 — Exportación completa a Excel

Tareas:

- selector de fechas;
- filtros opcionales por paciente, grupo y análisis;
- exportación tabular con una fila por resultado;
- columnas: DNI, paciente, fecha/hora, grupo, análisis, resultado, unidad, referencia, bandera, observación, creador y último editor;
- archivo con encabezados, filtros, fechas tipadas y DNI como texto;
- generación en servidor;
- límites y paginación interna para volúmenes grandes.

Criterios de aceptación:

- el DNI conserva ceros iniciales;
- Excel abre sin advertencias ni fórmulas rotas;
- el total exportado coincide con la consulta filtrada;
- ningún usuario no autenticado puede exportar.

### Fase 11 — Configuración

- nombre del laboratorio;
- logo opcional;
- pie del informe;
- listado de los tres usuarios y estado activo;
- sin roles, RUC, firma digital, retención avanzada ni MFA.

Las cuentas se crean de forma controlada fuera del registro público. No se expondrá `service_role` en el navegador.

### Fase 12 — Pruebas y despliegue

Pruebas:

```text
Login ------------ tres cuentas, recuperación y usuario inactivo
Pacientes -------- DNI válido, duplicado y búsquedas
Catálogo --------- tipos, unidades, rangos, archivo y versiones
Registro ---------- creación, autosave, resultados y anulación
Concurrencia ------ dos usuarios editando el mismo registro
Críticos ---------- advertencia visible y no bloqueante
Correcciones ------ edición y guardado directo
Impresión --------- Carta, grupos, textos largos, sello y firma
Estadísticas ------ reconciliación SQL y comparaciones
Exportación ------- filtros, conteos, DNI texto y volumen
Responsive -------- escritorio, tablet y móvil
Seguridad --------- RLS, rutas, logs y acceso anónimo
```

Salida:

- pruebas unitarias de reglas;
- integración con Supabase;
- E2E de los recorridos principales;
- prueba con los tres usuarios;
- revisión en los dispositivos e impresora reales;
- despliegue preview;
- aceptación del cliente;
- despliegue en Vercel;
- Excel anterior en modo de consulta, sin seguir registrando datos nuevos;
- seguimiento inicial de incidencias.

## 7. Prioridad de ejecución

### P0 — Operación básica

- migración del flujo simplificado;
- catálogo desde el Excel;
- 20 pacientes de muestra;
- pacientes y búsqueda;
- nuevo registro;
- captura y guardado real;
- edición directa;
- impresión Carta;
- RLS para usuarios equivalentes.

### P1 — Gestión

- Resultados completo;
- estadísticas;
- comparación por fechas;
- exportación Excel;
- configuración.

### P2 — Mejoras posteriores

- favoritos personales;
- atajos adicionales;
- variantes visuales de gráficas;
- personalización de columnas.

## 8. Entregas verificables

| Entrega | Resultado demostrable |
|---|---|
| E1. Base alineada | Tres usuarios equivalentes y esquema sin validación |
| E2. Catálogo y muestra | Catálogo del Excel y 20 pacientes sin duplicados |
| E3. Circuito principal | DNI → análisis → resultados → guardado real |
| E4. Historial e impresión | Corrección auditada e informe Carta |
| E5. Gestión | Cola, estadísticas, comparación y exportación |
| E6. Producción | QA, RLS, dispositivos, impresora y Vercel |

## 9. Pendientes mínimos

Las respuestas recibidas son suficientes para avanzar en la estructura y el circuito principal. Solo quedan estas comprobaciones concretas:

1. abrir el Excel mediante la herramienta autorizada para extraer catálogo, frecuencia y 20 pacientes;
2. confirmar visualmente un informe Carta de muestra antes de cerrar el diseño;
3. disponer de las otras dos cuentas para la prueba multiusuario;
4. confirmar el nombre corto que aparecerá en el encabezado del informe y si se usará logo.

No se necesitan RUC, políticas de retención detalladas, firmas digitales, canales de envío, tiempos de respuesta ni reglas de aprobación.

## 10. Definición de terminado

El sistema se considera completo cuando:

- los tres usuarios pueden trabajar con las mismas facultades;
- no quedan botones visibles sin funcionamiento;
- no existen datos demo en el ambiente real;
- pacientes, registros y resultados persisten en Supabase;
- se puede corregir y auditar;
- los críticos advierten sin bloquear;
- se imprime correctamente en Carta;
- las estadísticas y comparaciones usan datos reales;
- se exporta a Excel;
- la muestra de 20 pacientes está cargada sin duplicados;
- los recorridos funcionan en escritorio, tablet y móvil;
- las pruebas de RLS impiden acceso anónimo;
- build, pruebas y despliegue pasan.
