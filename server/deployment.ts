export interface DeploymentConfig {
  production: boolean;
  allowedOrigins: ReadonlySet<string>;
  trustProxyHops: number;
  requireHttps: boolean;
}

export interface ServerStartupConfig {
  host: string;
  port: number;
  deployment: DeploymentConfig;
}

export function resolveDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const production = env.NODE_ENV === 'production';
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid ALLOWED_ORIGINS value: ${origin}`);
    }
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      (production && parsed.protocol !== 'https:')
    ) {
      throw new Error(`ALLOWED_ORIGINS must contain exact${production ? ' HTTPS' : ''} origins: ${origin}`);
    }
  }

  const rawHops = env.TRUST_PROXY_HOPS ?? '0';
  const trustProxyHops = Number(rawHops);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
  }
  if (production && origins.length === 0) throw new Error('ALLOWED_ORIGINS is required in production');
  if (production && trustProxyHops === 0) throw new Error('TRUST_PROXY_HOPS must be positive in production');

  return { production, allowedOrigins: new Set(origins), trustProxyHops, requireHttps: production };
}

function parsePort(value: string | undefined, fallback?: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port! < 1 || port! > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return port!;
}

function parseHost(value: string | undefined, fallback?: string): string {
  const host = value ?? fallback;
  if (!host || host !== host.trim() || /[\s/]/.test(host) || host.includes('://')) {
    throw new Error('HOST must be an explicit hostname or IP address');
  }
  return host;
}

export function resolveProductionConfig(env: NodeJS.ProcessEnv = process.env): ServerStartupConfig {
  if (env.NODE_ENV !== 'production') {
    throw new Error('Production startup requires NODE_ENV=production');
  }
  return {
    host: parseHost(env.HOST),
    port: parsePort(env.PORT),
    deployment: resolveDeploymentConfig(env),
  };
}

export function resolveServerStartupConfig(env: NodeJS.ProcessEnv = process.env): ServerStartupConfig {
  if (env.NODE_ENV === 'production') return resolveProductionConfig(env);
  if (env.NODE_ENV && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error(`Unsupported NODE_ENV for server startup: ${env.NODE_ENV}`);
  }
  return {
    host: parseHost(env.HOST, '127.0.0.1'),
    port: parsePort(env.PORT, 3001),
    deployment: resolveDeploymentConfig(env),
  };
}
