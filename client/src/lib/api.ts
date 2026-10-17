const getBaseUrl = () => {
  // Always use the current origin! Backend is served from same domain.
  return window.location.origin;
};

const extractTenantFromPath = () => {
  const pathname = window.location.pathname;
  const pathParts = pathname.split('/');
  
  // Look for /store/{tenant} pattern in the path
  const storeIndex = pathParts.findIndex(part => part === 'store');
  if (storeIndex !== -1 && pathParts.length > storeIndex + 1) {
    const tenant = pathParts[storeIndex + 1];
    // Store in localStorage for future use
    localStorage.setItem('smartpos_tenant', tenant);
    return tenant;
  }
  
  // If path doesn't have /store/, check localStorage for stored tenant
  const storedTenant = localStorage.getItem('smartpos_tenant');
  if (storedTenant) {
    return storedTenant;
  }
  
  // Default fallback
  console.debug('No tenant found in URL path or localStorage, using default:', pathname);
  return 'default';
};

// Keep the old function name for backward compatibility but use the new logic
const extractSubdomain = extractTenantFromPath;

const getHeaders = () => {
  const token = localStorage.getItem('smartpos_token');
  const subdomain = extractSubdomain();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant-ID': subdomain,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    console.log('API: No token found in localStorage, Authorization header not added.');
  }
  console.log('API: Adding X-Tenant-ID header with subdomain:', subdomain);
  return headers;
};

const api = {
  async get<T = any>(endpoint: string): Promise<T> {
    try {
      const response = await fetch(`${getBaseUrl()}${endpoint}`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API GET Error (${response.status}): ${errorText || response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error(`API GET failed for ${endpoint}:`, error);
      throw error;
    }
  },

  async post<T = any>(endpoint: string, body: any): Promise<T> {
    try {
      const response = await fetch(`${getBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text();
        let message = `API POST Error (${response.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          message = errorJson.error || message;
        } catch {
          message = `${message}: ${errorText || response.statusText}`;
        }
        throw new Error(message);
      }
      return response.json();
    } catch (error) {
      console.error(`API POST failed for ${endpoint}:`, error);
      throw error;
    }
  },

  async patch<T = any>(endpoint: string, body: any): Promise<T> {
    try {
      const response = await fetch(`${getBaseUrl()}${endpoint}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API PATCH Error (${response.status}): ${errorText || response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error(`API PATCH failed for ${endpoint}:`, error);
      throw error;
    }
  },

  async put<T = any>(endpoint: string, body: any): Promise<T> {
    try {
      const response = await fetch(`${getBaseUrl()}${endpoint}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API PUT Error (${response.status}): ${errorText || response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error(`API PUT failed for ${endpoint}:`, error);
      throw error;
    }
  },

  async delete(endpoint: string) {
    try {
      const response = await fetch(`${getBaseUrl()}${endpoint}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API DELETE Error (${response.status}): ${errorText || response.statusText}`);
      }
      return true;
    } catch (error) {
      console.error(`API DELETE failed for ${endpoint}:`, error);
      throw error;
    }
  }
};

export default api;
