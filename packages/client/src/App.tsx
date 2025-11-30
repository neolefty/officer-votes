import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Election from './pages/Election';

export default function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/e/:code" element={<Election />} />
      </Routes>
    </div>
  );
}
