import React from 'react'
import ReactDOM from 'react-dom/client'
// Bundled rather than fetched from Google Fonts: the app makes no requests
// that are not to a calendar provider (or the update check), and works offline.
import '@fontsource-variable/inter'
import './styles/index.css'
import './i18n'
import App from './App'
import MiniApp from './mini/MiniApp'
import ErrorBoundary from './components/ErrorBoundary'

const isMini = window.location.hash === '#mini' || window.location.search.includes('mode=mini')

const rootElement = document.getElementById('root')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        {isMini ? <MiniApp /> : <App />}
      </ErrorBoundary>
    </React.StrictMode>
  )
}

