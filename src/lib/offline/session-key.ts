/**
 * La clave que descifra la copia local vivía solo en memoria, así que recargar
 * la página la perdía y había que volver a identificarse: el usuario lo vivía
 * como «se cerró la sesión sola».
 *
 * Aquí se guarda mientras dure la pestaña. `sessionStorage` se borra al cerrarla,
 * así que la protección que importa —un equipo apagado o robado, con la copia
 * cifrada en disco— no cambia; lo que se gana es que recargar no eche a nadie.
 * Al cerrar sesión se borra explícitamente.
 */
const STORE_KEY = "lims-jose:vault-key";

export function rememberVaultKey(value: string) {
  try {
    sessionStorage.setItem(STORE_KEY, value);
  } catch {
    // Ventana privada o almacenamiento bloqueado: se seguirá pidiendo la
    // contraseña al recargar, que es el comportamiento anterior.
  }
}

export function recallVaultKey() {
  try {
    return sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function forgetVaultKey() {
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Nada que borrar.
  }
}
