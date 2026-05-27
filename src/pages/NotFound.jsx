import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-serif text-3xl text-umc-900">Not found</h1>
      <p className="text-gray-600 mt-2">
        The page you were looking for doesn't exist.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  );
}
