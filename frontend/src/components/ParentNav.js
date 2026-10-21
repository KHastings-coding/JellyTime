import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const LINKS = [
  { to: '/parent', label: '🏠 Dashboard', exact: true },
  { to: '/parent/chores', label: '🧹 Chores & Checklists' },
  { to: '/parent/children', label: '👥 Kids' },
  { to: '/parent/settings', label: '⚙️ Settings' },
];

// Header for every parent page: optional back link, a title that truncates instead of
// pushing buttons off-screen, page actions, and a ☰ menu holding navigation and log out.
export default function ParentNav({ title, back = true, actions = null }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function logout() {
    localStorage.clear();
    navigate('/');
  }

  const isActive = l => (l.exact ? pathname === l.to : pathname.startsWith(l.to));

  return (
    <nav className="nav">
      {back && <Link to="/parent" className="btn btn-ghost nav-btn" aria-label="Back to dashboard">←</Link>}
      <span className="nav-title">{title}</span>
      {actions}
      <div className="nav-menu" ref={menuRef}>
        <button
          type="button"
          className="btn btn-ghost nav-btn"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >☰</button>
        {open && (
          <div className="nav-menu-panel" role="menu">
            {LINKS.map(l => (
              <Link
                key={l.to}
                to={l.to}
                role="menuitem"
                className={`nav-menu-item${isActive(l) ? ' active' : ''}`}
                aria-current={isActive(l) ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >{l.label}</Link>
            ))}
            <div className="nav-menu-divider" />
            <button type="button" role="menuitem" className="nav-menu-item" onClick={logout}>↩ Log out</button>
          </div>
        )}
      </div>
    </nav>
  );
}
