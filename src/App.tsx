import type { JSX } from 'react';
import styles from './App.module.css';

export function App(): JSX.Element {
  return (
    <div className={styles.viewport}>
      <p className={styles.placeholder}>zmesh — sculpt workspace coming soon</p>
    </div>
  );
}
