import styles from './install.module.css';

interface InstallScreenProps {
  /** Chrome / Firefox on iOS: suggest opening the page in Safari first. */
  otherBrowser: boolean;
  onContinueInBrowser: () => void;
}

const appIcon = `${import.meta.env.BASE_URL}apple-touch-icon.png`;

/** Help page shown in a Safari tab (§3): 3 illustrated steps to add the app to the home screen. */
export function InstallScreen({ otherBrowser, onContinueInBrowser }: InstallScreenProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <img className={styles.appIcon} src={appIcon} alt="" width={72} height={72} />
        <h1 className={styles.title}>Instala Bubilandia en tu iPhone</h1>
        <p className={styles.lead}>Así se abre a pantalla completa y funciona sin conexión en el gimnasio.</p>
      </header>

      {otherBrowser && (
        <p className={styles.notice}>Abre esta página en <strong>Safari</strong> para instalarla.</p>
      )}

      <ol className={styles.steps}>
        <li className={styles.step}>
          <span className={styles.number}>1</span>
          <div className={styles.stepText}>
            <p>
              Toca el botón <strong>Compartir</strong> de Safari (abajo en el centro, o arriba en el iPad).
            </p>
            <div className={styles.illustration} aria-hidden>
              <div className={styles.toolbar}>
                <span className={styles.toolbarIcon}>‹</span>
                <span className={styles.toolbarIcon}>›</span>
                <span className={`${styles.toolbarIcon} ${styles.highlight}`}>
                  <ShareIcon />
                </span>
                <span className={styles.toolbarIcon}>
                  <BookIcon />
                </span>
                <span className={styles.toolbarIcon}>
                  <TabsIcon />
                </span>
              </div>
            </div>
          </div>
        </li>

        <li className={styles.step}>
          <span className={styles.number}>2</span>
          <div className={styles.stepText}>
            <p>
              Desliza hacia abajo y toca <strong>«Añadir a pantalla de inicio»</strong>. Si no aparece, búscalo en{' '}
              <strong>«Más»</strong> o en <strong>«Editar acciones»</strong>.
            </p>
            <div className={styles.illustration} aria-hidden>
              <div className={styles.menu}>
                <span className={styles.menuRow}>
                  Copiar <CopyIcon />
                </span>
                <span className={`${styles.menuRow} ${styles.highlight}`}>
                  Añadir a pantalla de inicio <PlusSquareIcon />
                </span>
                <span className={styles.menuRow}>
                  Añadir marcador <BookIcon />
                </span>
              </div>
            </div>
          </div>
        </li>

        <li className={styles.step}>
          <span className={styles.number}>3</span>
          <div className={styles.stepText}>
            <p>
              Toca <strong>«Añadir»</strong> y abre <strong>Bubilandia</strong> desde el icono de tu pantalla de inicio.
            </p>
            <div className={styles.illustration} aria-hidden>
              <div className={styles.homeScreen}>
                <img src={appIcon} alt="" width={56} height={56} className={styles.homeIcon} />
                <span>Bubilandia</span>
              </div>
            </div>
          </div>
        </li>
      </ol>

      <div className={styles.warning}>
        <strong>Importante:</strong> la app instalada y esta pestaña de Safari <strong>no comparten los datos</strong>. Entrena
        siempre desde el icono de la pantalla de inicio.
      </div>

      <button type="button" className={styles.continue} onClick={onContinueInBrowser}>
        Seguir en el navegador de todos modos
      </button>
    </main>
  );
}

/* Simple generic glyphs drawn for the illustrations. */
const svgProps = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function ShareIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17" />
    </svg>
  );
}
function PlusSquareIcon() {
  return (
    <svg {...svgProps}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg {...svgProps}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5z" />
      <path d="M12 6v14" />
    </svg>
  );
}
function TabsIcon() {
  return (
    <svg {...svgProps}>
      <rect x="7" y="7" width="13" height="13" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
