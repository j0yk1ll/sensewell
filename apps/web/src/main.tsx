import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { fetchHealth } from './health';
import './styles.css';

function StatusPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 5000,
    retry: false,
  });

  let message = 'Checking PostgreSQL connection…';
  if (health.isError) {
    message = 'The Sensewell API is unreachable.';
  } else if (health.data?.status === 'unavailable') {
    message = 'The API cannot reach PostgreSQL.';
  } else if (health.data?.status === 'ready') {
    message = 'The API is connected to PostgreSQL.';
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-20 sm:py-28">
      <h1 className="mb-8 text-4xl font-semibold tracking-tight text-slate-900">Sensewell</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="app-status">
        <h2 id="app-status" className="text-lg font-medium text-slate-900">Application status</h2>
        <p className="mt-2 text-slate-700" role="status">{message}</p>
      </section>
    </main>
  );
}

const rootRoute = createRootRoute();
const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: StatusPage,
});
const router = createRouter({ routeTree: rootRoute.addChildren([statusRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing application root');

const queryClient = new QueryClient();
createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
