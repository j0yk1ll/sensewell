import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CameraWorkspace } from './camera-workspace';
import { authClient, SignIn } from './operator-auth';
import { fetchHealth } from './health';
import './styles.css';

function ConnectionStatus() {
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

  return <p className="text-xs text-slate-600" role="status">{message}</p>;
}

function App() {
  const session = authClient.useSession();
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-5 gap-y-1 px-5 py-4 sm:px-8">
          <h1 className="text-xl font-bold tracking-tight text-slate-950">Sensewell<span aria-hidden="true" className="text-teal-700">.</span></h1>
          <ConnectionStatus />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
        {session.isPending ? <p role="status">Checking your session…</p>
          : session.error ? <Card className="grid justify-items-start gap-3 p-5">
            <p className="error" role="alert">Could not check your session.</p>
            <Button variant="outline" type="button" onClick={() => void session.refetch()}>Retry</Button>
          </Card>
          : session.data ? <CameraWorkspace key={session.data.user.id} operator={session.data.user} />
          : <SignIn />}
      </main>
    </>
  );
}

const rootRoute = createRootRoute();
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});
const router = createRouter({ routeTree: rootRoute.addChildren([workspaceRoute]) });

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
