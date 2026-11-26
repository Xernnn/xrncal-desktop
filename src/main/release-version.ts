import { app } from 'electron'

/** The four-part public release version, with the npm SemVer as a fallback. */
export function releaseVersion(): string {
  return (typeof __XRNCAL_RELEASE_VERSION__ === 'string' && __XRNCAL_RELEASE_VERSION__) || app.getVersion()
}
