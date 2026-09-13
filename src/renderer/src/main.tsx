import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAME } from '../../shared/app'
import { App } from './App'
import { Capture } from './views/Capture'
import { Settings } from './views/Settings'
import { applyColors } from './theme'
import './styles.css'

// One bundle, one html, three things it can be. The quick capture box is a
// second window rather than a second app, and giving it its own build target
// and its own preload would be a lot of machinery for an input box. D3's
// settings window arrived on the same road for the same reason, which is why it
// cost a hash and a branch rather than a build.
// Step 9. Before React, and before anything is on screen: main handed this
// window its colours as a launch argument, so applying them here means the
// first frame is already painted in them rather than corrected a frame later.
// Both windows go through this file, so the capture box is themed by the same
// line.
applyColors(window.api.initialColors)

const hash = window.location.hash
const capturing = hash === '#capture'
const settings = hash === '#settings'

// The window title, and it has to be set here rather than left to the
// BrowserWindow option: a page's own title wins, so the settings window would
// otherwise be a second window called Bothy in the taskbar.
document.title = settings ? 'Settings' : APP_NAME
if (capturing) document.body.classList.add('is-capture')
if (settings) document.body.classList.add('is-settings')

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element is missing from index.html')
}

createRoot(root).render(
  <StrictMode>{capturing ? <Capture /> : settings ? <Settings /> : <App />}</StrictMode>
)
