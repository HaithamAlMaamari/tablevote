export interface DeploymentConfig {
  production: boolean;
  allowedOrigins: ReadonlySet<string>;
  trustProxyHops: number;
  requireHttps: boolean;
}

export function resolveDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const production = env.NODE_ENV === 'production';
  const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid ALLOWED_ORIGINS value: ${origin}`);
    }
    if (parsed.origin !== origin || parsed.username || parsed.password || (production && parsed.protocol !== 'https:')) {
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
