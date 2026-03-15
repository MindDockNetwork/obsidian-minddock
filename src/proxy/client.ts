/**
 * MindDock Proxy Client
 * 
 * Communicates with MindDock via a hidden iframe using postMessage.
 * This allows the plugin to use MindDock's E2EE encryption and Juno storage
 * without duplicating any code or exposing keys.
 */

export interface DockResult {
  success: boolean;
  noteId?: string;
  contentHash?: string;
  icTimestamp?: number;
  proofUrl?: string;
  isUpdate?: boolean;
  error?: string;
}

export interface VerifyResult {
  success: boolean;
  verified?: boolean;
  noteId?: string;
  timestamp?: number;
  action?: string;
  message?: string;
  error?: string;
}

export interface LoginResult {
  success: boolean;
  authenticated?: boolean;
  user?: UserInfo | null;
  error?: string;
}

export interface LogoutResult {
  success: boolean;
  error?: string;
}

export interface UserInfo {
  principal: string;
}

export interface PingResponse {
  authenticated: boolean;
  user: UserInfo | null;
  version: string;
}

type MessageHandler = (data: Record<string, unknown>) => void;

export class MindDockProxy {
  private iframe: HTMLIFrameElement | null = null;
  private ready = false;
  private authenticated = false;
  private user: UserInfo | null = null;
  private messageHandlers = new Map<string, MessageHandler>();
  private baseUrl: string;
  private initPromise: Promise<void> | null = null;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  
  constructor(baseUrl: string = 'https://app.minddock.network') {
    this.baseUrl = baseUrl;
  }
  
  /**
   * Initialize the proxy by loading MindDock in a hidden iframe
   */
  async initialize(): Promise<void> {
    // Prevent multiple initializations
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }
  
  private async _doInitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: MindDock proxy initialization took too long'));
      }, 30000);
      
      // Create hidden iframe
      this.iframe = document.createElement('iframe');
      this.iframe.src = `${this.baseUrl}/proxy?source=obsidian`;
      this.iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
      this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      
      // Setup message listener (store reference for cleanup)
      this.messageListener = (event: MessageEvent) => {
        // Validate origin
        if (!event.origin.includes('minddock')) {
          // In development, accept localhost
          if (!event.origin.includes('localhost') && event.origin !== 'null') {
            return;
          }
        }
        
        this.handleMessage(event);
      };
      
      window.addEventListener('message', this.messageListener);
      
      // Handle proxy ready message
      const readyHandler = (data: Record<string, unknown>) => {
        console.log('[MindDockProxy] Proxy ready signal received');
      };
      this.messageHandlers.set('proxy_ready', readyHandler);
      
      // Wait for iframe to load, then ping
      this.iframe.onload = async () => {
        console.log('[MindDockProxy] Iframe loaded, sending ping...');
        
        try {
          const response = await this.sendMessage<PingResponse>('ping', {});
          this.authenticated = response.authenticated;
          this.user = response.user;
          this.ready = true;
          
          clearTimeout(timeout);
          console.log('[MindDockProxy] Initialized:', {
            authenticated: this.authenticated,
            user: this.user
          });
          
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };
      
      this.iframe.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load MindDock proxy iframe'));
      };
      
      document.body.appendChild(this.iframe);
    });
  }
  
  /**
   * Handle incoming messages from the iframe
   */
  private handleMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    
    const { type, ...rest } = data;
    
    if (!type) return;
    
    console.log('[MindDockProxy] Received message:', type);
    
    // Handler key is simply the message type
    // 'pong' handler is registered on 'pong', 'dock_result' on 'dock_result', etc.
    const handlerKey = type;
    
    const handler = this.messageHandlers.get(handlerKey);
    if (handler) {
      console.log('[MindDockProxy] Found handler for:', handlerKey);
      handler(rest as Record<string, unknown>);
      // Clean up one-time handlers
      if (type !== 'proxy_ready') {
        this.messageHandlers.delete(handlerKey);
      }
    } else {
      console.log('[MindDockProxy] No handler for:', handlerKey, 'registered handlers:', Array.from(this.messageHandlers.keys()));
    }
  }
  
  /**
   * Send a message to the iframe and wait for response
   */
  private sendMessage<T>(type: string, data: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.iframe?.contentWindow) {
        reject(new Error('Proxy iframe not initialized'));
        return;
      }
      
      // Determine expected response type
      const responseType = type === 'ping' ? 'pong' : `${type}_result`;
      
      // Set up response handler
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(responseType);
        reject(new Error(`Timeout waiting for ${responseType}`));
      }, 30000);
      
      this.messageHandlers.set(responseType, (responseData) => {
        clearTimeout(timeoutId);
        resolve(responseData as T);
      });
      
      // Send message
      this.iframe.contentWindow.postMessage(
        { type, ...data },
        this.baseUrl
      );
    });
  }
  
  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }
  
  /**
   * Get current user info
   */
  getUser(): UserInfo | null {
    return this.user;
  }
  
  /**
   * Check if proxy is ready
   */
  isReady(): boolean {
    return this.ready;
  }
  
  /**
   * Refresh authentication status
   */
  async refreshAuth(): Promise<boolean> {
    if (!this.ready) {
      throw new Error('Proxy not initialized');
    }
    
    const response = await this.sendMessage<PingResponse>('ping', {});
    this.authenticated = response.authenticated;
    this.user = response.user;
    return this.authenticated;
  }
  
  /**
   * Dock a note to MindDock
   */
  async dock(
    title: string,
    content: string,
    obsidianPath: string,
    noteId?: string
  ): Promise<DockResult> {
    if (!this.ready) {
      throw new Error('Proxy not initialized');
    }
    
    if (!this.authenticated) {
      return {
        success: false,
        error: 'Not authenticated. Please login to MindDock first.'
      };
    }
    
    return this.sendMessage<DockResult>('dock', {
      title,
      content,
      obsidianPath,
      noteId
    });
  }
  
  /**
   * Verify a content hash
   */
  async verify(contentHash: string): Promise<VerifyResult> {
    if (!this.ready) {
      throw new Error('Proxy not initialized');
    }
    
    return this.sendMessage<VerifyResult>('verify', {
      contentHash
    });
  }
  
  /**
   * Login via Internet Identity
   * Opens external browser for login, then polls for session sync
   */
  async login(): Promise<LoginResult> {
    if (!this.ready) {
      throw new Error('Proxy not initialized');
    }
    
    console.log('[MindDockProxy] Starting login...');
    
    // Request login - proxy will return URL for external browser
    const initialResult = await this.sendMessage<LoginResult & { loginUrl?: string }>('login', {});
    
    if (initialResult.error === 'REQUIRES_EXTERNAL_LOGIN' && initialResult.loginUrl) {
      // Open external browser
      console.log('[MindDockProxy] Opening external browser for login...');
      window.open(initialResult.loginUrl, '_blank');
      
      // Start polling for session sync
      return this.pollForLogin();
    }
    
    // Direct login succeeded (shouldn't happen due to cross-origin restrictions)
    if (initialResult.success && initialResult.authenticated) {
      this.authenticated = true;
      this.user = initialResult.user || null;
    }
    
    return initialResult;
  }
  
  /**
   * Poll for login completion after external browser login
   */
  private async pollForLogin(): Promise<LoginResult> {
    const maxAttempts = 60; // 2 minutes of polling
    const pollInterval = 2000; // Every 2 seconds
    
    console.log('[MindDockProxy] Polling for login completion...');
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      try {
        // Refresh auth status
        const response = await this.sendMessage<PingResponse>('ping', {});
        
        if (response.authenticated) {
          console.log('[MindDockProxy] Login detected!');
          this.authenticated = true;
          this.user = response.user;
          return {
            success: true,
            authenticated: true,
            user: response.user
          };
        }
      } catch (error) {
        console.warn('[MindDockProxy] Poll failed:', error);
      }
    }
    
    // Timeout
    return {
      success: false,
      error: 'Login timeout - please try again'
    };
  }
  
  /**
   * Logout
   */
  async logout(): Promise<LogoutResult> {
    if (!this.ready) {
      throw new Error('Proxy not initialized');
    }
    
    console.log('[MindDockProxy] Logging out...');
    
    const result = await this.sendMessage<LogoutResult>('logout', {});
    
    if (result.success) {
      this.authenticated = false;
      this.user = null;
    }
    
    return result;
  }
  
  /**
   * Open MindDock login page in browser (fallback)
   * @deprecated Use login() for in-iframe authentication
   */
  openLogin(): void {
    window.open(`${this.baseUrl}/?login=obsidian`, '_blank');
  }
  
  /**
   * Clean up the proxy
   */
  destroy(): void {
    // Remove message listener to prevent duplicates
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.messageHandlers.clear();
    this.ready = false;
    this.authenticated = false;
    this.user = null;
    this.initPromise = null;
    console.log('[MindDockProxy] Destroyed and cleaned up');
  }
}
