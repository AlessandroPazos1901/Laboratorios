/**
 * La copia local se cifra con la contraseña de la cuenta, así que para abrirla
 * hace falta la contraseña — y en `/app` ya no está. De ahí salía el doble
 * ingreso: uno en la pantalla principal y otro al abrir los datos.
 *
 * `/login` deja aquí lo que acaba de teclear el usuario y `/app` lo recoge una
 * sola vez. Vive en una variable de módulo: sobrevive a la navegación interna
 * (misma pestaña, mismo contexto de JavaScript) y desaparece al recargar o
 * cerrar. No se guarda en disco ni en `sessionStorage`; una contraseña de
 * laboratorio no debe quedar en ningún almacén que sobreviva a la pestaña.
 */
let pending: { username: string; password: string } | null = null;

export function handOffCredentials(username: string, password: string) {
  pending = { username, password };
}

/** Devuelve las credenciales y las borra: un solo uso. */
export function takeHandedCredentials() {
  const credentials = pending;
  pending = null;
  return credentials;
}
