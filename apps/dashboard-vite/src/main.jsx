import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Notice we purposely DO NOT have import './index.css' here 
// so that Vite's default squishy margins don't ruin our full-screen map!

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)