# Tonic Life POS (Electron)

Terminal de punto de venta para sucursales. Ver `../CLAUDE.md` (workspace) para
contexto general del sistema.

## Desarrollo

```bash
npm install
npm run dev          # Vite + Electron con hot reload
npm run typecheck    # tsc --noEmit
npm run build        # instalador local (release/) sin publicar
```

## Publicar una actualización (auto-update)

Las terminales instaladas se actualizan solas vía **electron-updater** leyendo
los releases de GitHub del repo **público** `dramirez-tl/toniclife-pos-releases`
(solo artefactos; el código vive en este repo privado). Cada terminal revisa al
arrancar y cada 4 horas, descarga en silencio y le muestra al cajero el aviso
"Reiniciar y actualizar"; si no reinicia, se instala al cerrar la app.

Pasos para sacar versión:

1. Sube la versión en `package.json` (ej. `2.0.1` → `2.0.2`). Esa versión se
   inyecta en build-time al header y al `X-App-Version`.
2. Exporta un token de GitHub con permiso de escribir releases en el repo de
   releases (classic PAT con scope `repo`, o fine-grained con Contents RW):

   ```powershell
   $env:GH_TOKEN = "ghp_..."
   ```

3. Publica:

   ```bash
   npm run release
   ```

   Esto compila, empaqueta el NSIS y sube a GitHub Releases: el instalador
   `.exe`, el `.blockmap` (delta) y `latest.yml` (el manifiesto que leen las
   terminales). El release se crea como **draft**: revísalo en GitHub y
   publícalo para liberar la actualización.

Requisito de una sola vez: crear el repo **público** `toniclife-pos-releases`
en la organización (vacío, solo para releases).

Notas:

- El updater solo corre empaquetado (`app.isPackaged`); en `npm run dev` es no-op.
- Log de updates en la terminal: `%APPDATA%/toniclife-electron/logs/updater.log`.
- Sin firma de código (por ahora): Windows SmartScreen puede avisar en la
  PRIMERA instalación manual; las auto-actualizaciones posteriores no vuelven a
  preguntar. Si se adquiere un certificado de firma, se agrega en `build.win`.
