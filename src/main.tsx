import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './similarity.css';
import './phase4.css';
import './external.css';
import './phase6.css';
import './phase7.css';
import './phase8.css';
import './plagguard.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
