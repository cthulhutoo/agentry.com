# Technical Design Document: Computer Use Agents Feature
## Agentry.com - BMad v6 Implementation

**Document Version:** 1.0  
**Created:** 2026-02-26  
**Status:** Technical Specification  
**Total Effort:** 480 hours (26 tasks across 4 phases)

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENTRY.COM ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │   Web App   │    │Mobile Apps  │    │  API Client │                  │
│  │  (React)    │    │  (React)    │    │   (REST)    │                  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
│         │                  │                  │                           │
│         └──────────────────┼──────────────────┘                           │
│                            ▼                                                 │
│              ┌─────────────────────────────┐                              │
│              │   Supabase Edge Functions   │                              │
│              │   (Deno Runtime)            │                              │
│              └──────────────┬──────────────┘                              │
│                             │                                               │
│         ┌───────────────────┼───────────────────┐                          │
│         ▼                   ▼                   ▼                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │   Council   │    │  Computer   │    │   Stripe    │                  │
│  │   Task      │    │  Use Agent  │    │  Payment    │                  │
│  │  Processor  │    │  Executor   │    │  Gateway    │                  │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘                  │
│         │                  │                                               │
│         └──────────────────┼───────────────────────┐                      │
│                            ▼                        ▼                      │
│              ┌─────────────────────────┐  ┌─────────────────┐           │
│              │    PostgreSQL Database   │  │  External APIs  │           │
│              │    (Supabase)            │  │  (Anthropic,    │           │
│              │                         │  │   OpenAI, GAI)  │           │
│              └─────────────────────────┘  └─────────────────┘           │
│                            │                        │                      │
│                            ▼                        ▼                      │
│              ┌─────────────────────────┐  ┌─────────────────┐           │
│              │  Browser Automation     │  │  Compute       │           │
│              │  (Playwright/Puppeteer) │  │  Workers       │           │
│              └─────────────────────────┘  └─────────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Architecture - Computer Use Agents

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COMPUTER USE AGENTS COMPONENT DIAGRAM                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    COMPUTER USE AGENT SERVICE                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │                     Orchestrator Layer                          │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐ │ │  │
│  │  │  │ Task Manager  │ │ Agent Pool    │ │ Session Manager       │ │ │  │
│  │  │  │               │ │ (Isolated)    │ │ (Stateful)            │ │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────────────┘ │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │                               │                                        │  │
│  │  ┌─────────────────────────────┴───────────────────────────────────┐ │  │
│  │  │                    Execution Layer                              │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐ │ │  │
│  │  │  │ Browser       │ │ Action        │ │ Screenshot            │ │ │  │
│  │  │  │ Controller    │ │ Executor      │ │ Analyzer (Vision)    │ │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────────────┘ │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │                               │                                        │  │
│  │  ┌─────────────────────────────┴───────────────────────────────────┐ │  │
│  │  │                    Safety Layer                                 │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐ │ │  │
│  │  │  │ Policy        │ │ Audit         │ │ Sandboxing            │ │ │  │
│  │  │  │ Enforcer      │ │ Logger        │ │ (Isolated Browser)    │ │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────────────┘ │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DATA FLOW DIAGRAM                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER → API REQUEST → AUTHENTICATION → RATE LIMIT CHECK                    │
│       │                    │               │                               │
│       │                    │               ▼                               │
│       │                    │       ┌───────────────┐                      │
│       │                    │       │ Credit Check  │                      │
│       │                    │       └───────┬───────┘                      │
│       │                    │               │                               │
│       │                    ▼               ▼                               ▼
│       │            ┌─────────────────────────────────────────────┐         │
│       │            │         TASK QUEUE (Supabase)               │         │
│       │            │  ┌─────────────────────────────────────────┐│         │
│       │            │  │ computer_use_tasks table                 ││         │
│       │            │  │ - id, user_id, prompt, status            ││         │
│       │            │  │ - actions (JSONB), results               ││         │
│       │            │  └─────────────────────────────────────────┘│         │
│       │            └───────────────────┬─────────────────────────┘         │
│       │                                │                                    │
│       │                                ▼                                    │
│       │                    ┌─────────────────────────┐                      │
│       │                    │  WORKER PROCESSOR        │                      │
│       │                    │  ┌─────────────────────┐ │                      │
│       │                    │  │ 1. Analyze Prompt   │ │                      │
│       │                    │  │ 2. Plan Actions     │ │                      │
│       │                    │  │ 3. Execute in       │ │                      │
│       │                    │  │    Sandbox           │ │                      │
│       │                    │  │ 4. Capture Results   │ │                      │
│       │                    │  │ 5. Verify Outcomes  │ │                      │
│       │                    │  └─────────────────────┘ │                      │
│       │                    └────────────┬────────────┘                      │
│       │                                 │                                    │
│       │                                 ▼                                    │
│       │                    ┌─────────────────────────┐                      │
│       │                    │  BROWSER AUTOMATION     │                      │
│       │                    │  (Playwright Instance)  │                      │
│       │                    │  - Isolated Browser     │                      │
│       │                    │  - Virtual Display      │                      │
│       │                    │  - Limited Network      │                      │
│       │                    └────────────┬────────────┘                      │
│       │                                 │                                    │
│       │                                 ▼                                    │
│       │                    ┌─────────────────────────┐                      │
│       │                    │  VISION ANALYSIS        │                      │
│       │                    │  (Screenshot OCR/Vision)│                     │
│       │                    └────────────┬────────────┘                      │
│       │                                 │                                    │
│       └─────────────────────────────────┼────────────────────────────────────┘
│                                         ▼                                    │
│                              ┌──────────────────────┐                       │
│                              │   RESPONSE TO USER   │                       │
│                              │   - Task Results      │                       │
│                              │   - Execution Log     │                       │
│                              │   - Screenshots      │                       │
│                              └───────────────────────┘                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. API Endpoints (OpenAPI 3.0 Specification)

### 2.1 Computer Use Agents API

```yaml
openapi: 3.0.3
info:
  title: Agentry Computer Use Agents API
  description: API for managing and executing computer use agent tasks
  version: 1.0.0
  contact:
    name: Agentry API Support
    email: api@agentry.com

servers:
  - url: https://agentry.com/api/v1
    description: Production server
  - url: https://staging.agentry.com/api/v1
    description: Staging server

security:
  - BearerAuth: []
  - ApiKeyAuth: []

tags:
  - name: computer-use-tasks
    description: Computer use agent task management
  - name: agent-sessions
    description: Browser session management
  - name: action-templates
    description: Predefined action templates
  - name: audit-logs
    description: Execution audit and logging

paths:
  /computer-use/tasks:
    post:
      tags:
        - computer-use-tasks
      summary: Create a new computer use task
      description: |
        Creates a new task for the computer use agent to execute.
        The agent will analyze the prompt and execute browser/UI actions.
      operationId: createComputerUseTask
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ComputerUseTaskRequest'
            examples:
              browser_navigation:
                summary: Browser Navigation Example
                value:
                  prompt: "Navigate to github.com and check if the repository agentry exists"
                  max_steps: 20
                  timeout_ms: 120000
                  session_id: null
                  allow_downloads: false
                  allowed_domains:
                    - "github.com"
                    - "*.github.com"
              form_filling:
                summary: Form Filling Example
                value:
                  prompt: "Fill out the contact form on example.com with name John, email john@example.com"
                  max_steps: 15
                  timeout_ms: 90000
      responses:
        '202':
          description: Task accepted for processing
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskResponse'
        '400':
          description: Invalid request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '402':
          description: Insufficient credits
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InsufficientCreditsResponse'
        '429':
          description: Rate limit exceeded
          headers:
            X-RateLimit-Limit:
              schema:
                type: integer
            X-RateLimit-Remaining:
              schema:
                type: integer
            X-RateLimit-Reset:
              schema:
                type: integer
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

    get:
      tags:
        - computer-use-tasks
      summary: List computer use tasks
      description: Returns a paginated list of user's computer use tasks
      operationId: listComputerUseTasks
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
            minimum: 1
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
        - name: status
          in: query
          schema:
            type: string
            enum: [pending, processing, completed, failed, cancelled]
        - name: created_after
          in: query
          schema:
            type: string
            format: date-time
        - name: created_before
          in: query
          schema:
            type: string
            format: date-time
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskListResponse'

  /computer-use/tasks/{taskId}:
    get:
      tags:
        - computer-use-tasks
      summary: Get task details
      description: Returns detailed information about a specific task
      operationId: getTaskDetails
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Task details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskDetailResponse'
        '404':
          description: Task not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

    delete:
      tags:
        - computer-use-tasks
      summary: Cancel a task
      description: Attempts to cancel a pending or processing task
      operationId: cancelTask
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Task cancelled
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskResponse'
        '400':
          description: Task cannot be cancelled (already completed/failed)
        '404':
          description: Task not found

  /computer-use/tasks/{taskId}/screenshot:
    get:
      tags:
        - computer-use-tasks
      summary: Get task screenshot
      description: Returns the current screenshot of the browser session
      operationId: getTaskScreenshot
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: step
          in: query
          description: Specific step number (latest if not specified)
          schema:
            type: integer
      responses:
        '200':
          description: Screenshot image
          content:
            image/png:
              schema:
                type: string
                format: binary
        '404':
          description: Screenshot not found

    get:
      tags:
        - computer-use-tasks
      summary: Get task screenshots as ZIP
      description: Returns all screenshots as a ZIP file
      operationId: getTaskScreenshotsZip
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: ZIP file with screenshots
          content:
            application/zip:
              schema:
                type: string
                format: binary

  /computer-use/sessions:
    post:
      tags:
        - agent-sessions
      summary: Create a browser session
      description: Creates a new isolated browser session
      operationId: createSession
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SessionRequest'
      responses:
        '201':
          description: Session created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionResponse'

    get:
      tags:
        - agent-sessions
      summary: List active sessions
      description: Returns list of user's active browser sessions
      operationId: listSessions
      responses:
        '200':
          description: Session list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionListResponse'

  /computer-use/sessions/{sessionId}:
    get:
      tags:
        - agent-sessions
      summary: Get session details
      operationId: getSessionDetails
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Session details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionDetailResponse'

    delete:
      tags:
        - agent-sessions
      summary: Terminate a session
      operationId: terminateSession
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Session terminated

  /computer-use/action-templates:
    get:
      tags:
        - action-templates
      summary: List action templates
      description: Returns predefined action templates for common tasks
      operationId: listActionTemplates
      parameters:
        - name: category
          in: query
          schema:
            type: string
            enum: [navigation, form, scraping, automation]
      responses:
        '200':
          description: Template list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ActionTemplateListResponse'

  /computer-use/audit-logs:
    get:
      tags:
        - audit-logs
      summary: Get audit logs
      description: Returns audit logs for computer use operations
      operationId: getAuditLogs
      parameters:
        - name: taskId
          in: query
          schema:
            type: string
            format: uuid
        - name: userId
          in: query
          schema:
            type: string
            format: uuid
        - name: start_date
          in: query
          schema:
            type: string
            format: date
        - name: end_date
          in: query
          schema:
            type: string
            format: date
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
      responses:
        '200':
          description: Audit logs
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuditLogListResponse'

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key

  schemas:
    ComputerUseTaskRequest:
      type: object
      required:
        - prompt
      properties:
        prompt:
          type: string
          description: Natural language description of the task
          maxLength: 5000
        max_steps:
          type: integer
          description: Maximum number of actions to execute
          default: 20
          minimum: 1
          maximum: 100
        timeout_ms:
          type: integer
          description: Task timeout in milliseconds
          default: 120000
          minimum: 10000
          maximum: 600000
        session_id:
          type: string
          format: uuid
          description: Optional existing session to reuse
        allow_downloads:
          type: boolean
          description: Whether to allow file downloads
          default: false
        allowed_domains:
          type: array
          items:
            type: string
          description: List of allowed domains (wildcards supported)
          maxItems: 50
        blocked_domains:
          type: array
          items:
            type: string
          description: List of explicitly blocked domains
          maxItems: 50
        user_agent:
          type: string
          description: Custom user agent string
        viewport:
          $ref: '#/components/schemas/ViewportConfig'
        credentials:
          $ref: '#/components/schemas/Credentials'
        metadata:
          type: object
          description: Additional task metadata
          additionalProperties:
            type: string

    ViewportConfig:
      type: object
      properties:
        width:
          type: integer
          default: 1280
        height:
          type: integer
          default: 720
        device_scale_factor:
          type: number
          default: 1.0

    Credentials:
      type: object
      properties:
        username:
          type: string
        password:
          type: string
        otp_code:
          type: string

    TaskResponse:
      type: object
      properties:
        id:
          type: string
          format: uuid
        status:
          type: string
          enum: [pending, processing, completed, failed, cancelled]
        created_at:
          type: string
          format: date-time
        credits_charged:
          type: integer
        session_id:
          type: string
          format: uuid

    TaskDetailResponse:
      type: object
      properties:
        id:
          type: string
          format: uuid
        status:
          type: string
          enum: [pending, processing, completed, failed, cancelled]
        prompt:
          type: string
        created_at:
          type: string
          format: date-time
        started_at:
          type: string
          format: date-time
        completed_at:
          type: string
          format: date-time
        credits_charged:
          type: integer
        actions:
          type: array
          items:
            $ref: '#/components/schemas/ExecutedAction'
        results:
          type: object
        error_message:
          type: string
        screenshots:
          type: array
          items:
            $ref: '#/components/schemas/ScreenshotInfo'

    ExecutedAction:
      type: object
      properties:
        step:
          type: integer
        action_type:
          type: string
          enum: [navigate, click, type, select, scroll, screenshot, wait, evaluate, download, upload]
        selector:
          type: string
        value:
          type: string
        timestamp:
          type: string
          format: date-time
        duration_ms:
          type: integer
        success:
          type: boolean
        error:
          type: string

    ScreenshotInfo:
      type: object
      properties:
        step:
          type: integer
        url:
          type: string
        timestamp:
          type: string
          format: date-time

    TaskListResponse:
      type: object
      properties:
        tasks:
          type: array
          items:
            $ref: '#/components/schemas/TaskResponse'
        pagination:
          $ref: '#/components/schemas/Pagination'

    Pagination:
      type: object
      properties:
        page:
          type: integer
        limit:
          type: integer
        total:
          type: integer
        total_pages:
          type: integer

    InsufficientCreditsResponse:
      type: object
      properties:
        error:
          type: string
          enum: [insufficient_credits]
        message:
          type: string
        balance:
          type: integer
        required:
          type: integer
        upgrade_url:
          type: string
          format: uri

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
        code:
          type: string
        details:
          type: object

    SessionRequest:
      type: object
      properties:
        browser_type:
          type: string
          enum: [chromium, firefox, webkit]
          default: chromium
        allowed_domains:
          type: array
          items:
            type: string
        blocked_domains:
          type: array
          items:
            type: string
        user_agent:
          type: string
        viewport:
          $ref: '#/components/schemas/ViewportConfig'
        enable_recordings:
          type: boolean
          default: false

    SessionResponse:
      type: object
      properties:
        id:
          type: string
          format: uuid
        status:
          type: string
          enum: [active, terminated]
        created_at:
          type: string
          format: date-time
        expires_at:
          type: string
          format: date-time

    SessionListResponse:
      type: object
      properties:
        sessions:
          type: array
          items:
            $ref: '#/components/schemas/SessionResponse'

    SessionDetailResponse:
      allOf:
        - $ref: '#/components/schemas/SessionResponse'
        - type: object
          properties:
            current_url:
              type: string
            current_title:
              type: string
            cookies:
              type: array
              items:
                type: object
            storage:
              type: object

    ActionTemplateListResponse:
      type: object
      properties:
        templates:
          type: array
          items:
            $ref: '#/components/schemas/ActionTemplate'

    ActionTemplate:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        category:
          type: string
        description:
          type: string
        actions:
          type: array
          items:
            type: object

    AuditLogListResponse:
      type: object
      properties:
        logs:
          type: array
          items:
            $ref: '#/components/schemas/AuditLog'
        pagination:
          $ref: '#/components/schemas/Pagination'

    AuditLog:
      type: object
      properties:
        id:
          type: string
          format: uuid
        timestamp:
          type: string
          format: date-time
        user_id:
          type: string
          format: uuid
        task_id:
          type: string
          format: uuid
        action:
          type: string
        resource:
          type: string
        details:
          type: object
        ip_address:
          type: string
        user_agent:
          type: string
```

---

## 3. Database Schema (PostgreSQL with RLS)

### 3.1 Core Tables

```sql
-- ============================================================================
-- COMPUTER USE AGENTS DATABASE SCHEMA
-- ============================================================================
-- Version: 1.0.0
-- Created: 2026-02-26
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLE: computer_use_tasks
-- ============================================================================
CREATE TABLE computer_use_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Task Definition
    prompt TEXT NOT NULL,
    max_steps INTEGER NOT NULL DEFAULT 20,
    timeout_ms INTEGER NOT NULL DEFAULT 120000,
    
    -- Session Configuration
    session_id UUID REFERENCES computer_use_sessions(id) ON DELETE SET NULL,
    browser_type VARCHAR(20) DEFAULT 'chromium',
    
    -- Domain Control
    allowed_domains TEXT[] DEFAULT '{}',
    blocked_domains TEXT[] DEFAULT '{}',
    
    -- Capabilities
    allow_downloads BOOLEAN DEFAULT false,
    allow_uploads BOOLEAN DEFAULT false,
    allow_notifications BOOLEAN DEFAULT false,
    
    -- Execution State
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'queued', 'processing', 
                          'completed', 'failed', 'cancelled', 'timeout')),
    
    -- Results
    actions JSONB DEFAULT '[]',
    results JSONB DEFAULT '{}',
    error_message TEXT,
    
    -- Screenshots Storage
    screenshot_bucket TEXT DEFAULT 'task-screenshots',
    screenshot_count INTEGER DEFAULT 0,
    
    -- Execution Metrics
    steps_executed INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    credits_charged INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Indexes for computer_use_tasks
CREATE INDEX idx_cu_tasks_user_id ON computer_use_tasks(user_id);
CREATE INDEX idx_cu_tasks_status ON computer_use_tasks(status);
CREATE INDEX idx_cu_tasks_created_at ON computer_use_tasks(created_at DESC);
CREATE INDEX idx_cu_tasks_session_id ON computer_use_tasks(session_id);

-- ============================================================================
-- TABLE: computer_use_sessions
-- ============================================================================
CREATE TABLE computer_use_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Browser Configuration
    browser_type VARCHAR(20) NOT NULL DEFAULT 'chromium',
    user_agent TEXT,
    viewport_width INTEGER DEFAULT 1280,
    viewport_height INTEGER DEFAULT 720,
    device_scale_factor DECIMAL(3,2) DEFAULT 1.0,
    
    -- Domain Control
    allowed_domains TEXT[] DEFAULT '{}',
    blocked_domains TEXT[] DEFAULT '{}',
    
    -- State
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'idle', 'terminated', 'error')),
    current_url TEXT,
    current_title TEXT,
    
    -- Capabilities
    enable_recordings BOOLEAN DEFAULT false,
    enable_downloads BOOLEAN DEFAULT false,
    
    -- Browser Storage (serialized cookies/localStorage)
    cookies JSONB DEFAULT '[]',
    local_storage JSONB DEFAULT '{}',
    session_storage JSONB DEFAULT '{}',
    
    -- Metrics
    actions_count INTEGER DEFAULT 0,
    pages_visited INTEGER DEFAULT 0,
    
    -- Expiration
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    terminated_at TIMESTAMPTZ
);

-- Indexes for computer_use_sessions
CREATE INDEX idx_cu_sessions_user_id ON computer_use_sessions(user_id);
CREATE INDEX idx_cu_sessions_status ON computer_use_sessions(status);
CREATE INDEX idx_cu_sessions_expires_at ON computer_use_sessions(expires_at);

-- ============================================================================
-- TABLE: computer_use_actions (Action History)
-- ============================================================================
CREATE TABLE computer_use_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES computer_use_tasks(id) ON DELETE CASCADE,
    session_id UUID REFERENCES computer_use_sessions(id) ON DELETE SET NULL,
    
    -- Action Details
    step_number INTEGER NOT NULL,
    action_type VARCHAR(50) NOT NULL
        CHECK (action_type IN (
            'navigate', 'goto', 'click', 'double_click', 'right_click',
            'hover', 'type', 'paste', 'select', 'select_option',
            'check', 'uncheck', 'scroll', 'scroll_up', 'scroll_down',
            'screenshot', 'full_screenshot', 'wait', 'wait_for_selector',
            'wait_for_navigation', 'evaluate', 'js_exec',
            'download', 'upload', 'press_key', 'send_keys',
            'go_back', 'go_forward', 'reload', 'close'
        )),
    
    -- Action Parameters
    selector TEXT,
    selector_type VARCHAR(20)
        CHECK (selector_type IN ('css', 'xpath', 'text', 'id', 'class', 'role')),
    value TEXT,
    options JSONB DEFAULT '{}',
    
    -- Execution Result
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    duration_ms INTEGER,
    
    -- Pre/Post State
    url_before TEXT,
    url_after TEXT,
    screenshot_path TEXT,
    
    -- AI Reasoning
    reasoning TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for computer_use_actions
CREATE INDEX idx_cu_actions_task_id ON computer_use_actions(task_id);
CREATE INDEX idx_cu_actions_session_id ON computer_use_actions(session_id);
CREATE INDEX idx_cu_actions_created_at ON computer_use_actions(created_at);

-- ============================================================================
-- TABLE: computer_use_action_templates
-- ============================================================================
CREATE TABLE computer_use_action_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL
        CHECK (category IN ('navigation', 'form', 'scraping', 'automation', 'testing')),
    
    -- Template Definition
    actions JSONB NOT NULL,
    parameters JSONB DEFAULT '{}',
    
    -- Usage
    usage_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 100.00,
    
    -- Visibility
    is_public BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: computer_use_audit_logs
-- ============================================================================
CREATE TABLE computer_use_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    
    -- Action
    action_type VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    
    -- Details
    action_details JSONB DEFAULT '{}',
    
    -- Outcome
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    -- Correlation
    task_id UUID REFERENCES computer_use_tasks(id) ON DELETE SET NULL,
    session_id UUID REFERENCES computer_use_sessions(id) ON DELETE SET NULL,
    request_id UUID,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit logs
CREATE INDEX idx_cu_audit_user_id ON computer_use_audit_logs(user_id);
CREATE INDEX idx_cu_audit_task_id ON computer_use_audit_logs(task_id);
CREATE INDEX idx_cu_audit_created_at ON computer_use_audit_logs(created_at DESC);
CREATE INDEX idx_cu_audit_action_type ON computer_use_audit_logs(action_type);

-- ============================================================================
-- TABLE: computer_use_policy_rules
-- ============================================================================
CREATE TABLE computer_use_policy_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Rule Definition
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_type VARCHAR(50) NOT NULL
        CHECK (rule_type IN ('domain', 'action', 'time', 'resource', 'custom')),
    
    -- Condition
    condition JSONB NOT NULL,
    -- Example: {"domain": "*.github.com", "action": "download", "max_per_hour": 10}
    
    -- Effect
    effect VARCHAR(20) NOT NULL CHECK (effect IN ('allow', 'deny', 'warn', 'rate_limit')),
    
    -- Priority (higher = more important)
    priority INTEGER DEFAULT 0,
    
    -- Scope
    is_global BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id),
    
    -- State
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: computer_use_credentials (Encrypted)
-- ============================================================================
CREATE TABLE computer_use_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Credential Info (encrypted)
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    encrypted_username BYTEA NOT NULL,
    encrypted_password BYTEA NOT NULL,
    
    -- Metadata
    username_field VARCHAR(100),
    password_field VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for credentials lookup
CREATE INDEX idx_cu_credentials_user_domain ON computer_use_credentials(user_id, domain);

-- ============================================================================
-- FUNCTION: Credit Consumption
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_computer_use_credits(
    p_steps INTEGER,
    p_timeout_ms INTEGER,
    p_screenshots INTEGER
) RETURNS INTEGER AS $$
DECLARE
    base_credits INTEGER := 1;  -- Base cost per task
    step_credits INTEGER := 1;    -- Credits per step
    timeout_credits INTEGER := 0;
    screenshot_credits INTEGER := 1;
BEGIN
    -- Calculate timeout tier (every 60 seconds = 1 credit)
    timeout_credits := (p_timeout_ms / 60000);
    IF timeout_credits > 5 THEN
        timeout_credits := 5;  -- Cap at 5 extra credits
    END IF;
    
    RETURN base_credits + (p_steps * step_credits) + timeout_credits + (p_screenshots * screenshot_credits);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE computer_use_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_action_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_credentials ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TASKS POLICIES
-- ============================================================================

-- Users can view their own tasks
CREATE POLICY "Users can view own computer use tasks"
    ON computer_use_tasks FOR SELECT
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Users can create tasks
CREATE POLICY "Users can create computer use tasks"
    ON computer_use_tasks FOR INSERT
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users can update their own tasks
CREATE POLICY "Users can update own computer use tasks"
    ON computer_use_tasks FOR UPDATE
    USING (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users can delete their own tasks
CREATE POLICY "Users can delete own computer use tasks"
    ON computer_use_tasks FOR DELETE
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Service role can access all
CREATE POLICY "Service role can manage all tasks"
    ON computer_use_tasks FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- SESSIONS POLICIES
-- ============================================================================

-- Users can manage their own sessions
CREATE POLICY "Users can manage own sessions"
    ON computer_use_sessions FOR ALL
    USING (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Service role full access
CREATE POLICY "Service role can manage all sessions"
    ON computer_use_sessions FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- ACTIONS POLICIES
-- ============================================================================

-- Users can access actions from their tasks
CREATE POLICY "Users can view own actions"
    ON computer_use_actions FOR SELECT
    USING (
        task_id IN (
            SELECT id FROM computer_use_tasks 
            WHERE user_id = auth.uid() OR user_id IS NULL
        )
    );

-- Service role full access
CREATE POLICY "Service role can manage all actions"
    ON computer_use_actions FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- AUDIT LOGS POLICIES
-- ============================================================================

-- Users can view their own audit logs
CREATE POLICY "Users can view own audit logs"
    ON computer_use_audit_logs FOR SELECT
    USING (user_id = auth.uid());

-- Service role and admins can view all
CREATE POLICY "Admins can view all audit logs"
    ON computer_use_audit_logs FOR SELECT
    USING (auth.role() = 'service_role' OR auth.jwt()->>'role' = 'admin');

-- ============================================================================
-- ACTION TEMPLATES POLICIES
-- ============================================================================

-- Anyone can view public templates
CREATE POLICY "Anyone can view public templates"
    ON computer_use_action_templates FOR SELECT
    USING (is_public = true);

-- Users can manage their own templates
CREATE POLICY "Users can manage own templates"
    ON computer_use_action_templates FOR ALL
    USING (created_by = auth.uid() OR is_public = true)
    WITH CHECK (created_by = auth.uid() OR is_public = true);

-- ============================================================================
-- POLICY RULES POLICIES
-- ============================================================================

-- Users can manage their own policy rules
CREATE POLICY "Users can manage own policy rules"
    ON computer_use_policy_rules FOR ALL
    USING (user_id = auth.uid() OR is_global = true)
    WITH CHECK (user_id = auth.uid() OR is_global = true);

-- Service role can manage all
CREATE POLICY "Service role can manage all policies"
    ON computer_use_policy_rules FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- CREDENTIALS POLICIES
-- ============================================================================

-- Users can manage their own credentials
CREATE POLICY "Users can manage own credentials"
    ON computer_use_credentials FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Service role can access
CREATE POLICY "Service role can manage credentials"
    ON computer_use_credentials FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- STORAGE BUCKET FOR SCREENSHOTS
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_types)
VALUES ('task-screenshots', 'task-screenshots', true, 10485760, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Users can manage own screenshots"
    ON storage.objects FOR ALL
    USING (bucket_id = 'task-screenshots');
```

---

## 4. Service Components

### 4.1 Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SERVICE COMPONENTS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ORCHESTRATION LAYER                              │   │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │   │
│  │  │ TaskOrchestrator │ │ SessionPool      │ │ CreditManager   │    │   │
│  │  │                  │ │                  │ │                  │    │   │
│  │  │ - Task lifecycle │ │ - Browser pool   │ │ - Credit check  │    │   │
│  │  │ - Queue mgmt     │ │ - Session state  │ │ - Deduction     │    │   │
│  │  │ - Step execution │ │ - Cleanup        │ │ - Refund        │    │   │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      EXECUTION LAYER                                 │   │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │   │
│  │  │ BrowserController│ │ ActionExecutor   │ │ VisionAnalyzer   │    │   │
│  │  │                  │ │                  │ │                  │    │   │
│  │  │ - Launch/Config  │ │ - Click/Type     │ │ - OCR            │    │   │
│  │  │ - Navigation     │ │ - Select/Wait   │ │ - Element detect │    │   │
│  │  │ - Screenshot     │ │ - Evaluate JS   │ │ - UI validation  │    │   │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘    │   │
│  │  ┌──────────────────┐ ┌──────────────────┐                         │   │
│  │  │ LLMReasoning     │ │ StateManager     │                         │   │
│  │  │                  │ │                  │                         │   │
│  │  │ - Action planning│ │ - Cookie mgmt   │                         │   │
│  │  │ - Error recovery │ │ - Storage        │                         │   │
│  │  │ - Result summariz│ │ - History        │                         │   │
│  │  └──────────────────┘ └──────────────────┘                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       SAFETY LAYER                                  │   │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │   │
│  │  │ PolicyEnforcer   │ │ AuditLogger      │ │ RateLimiter      │    │   │
│  │  │                  │ │                  │ │                  │    │   │
│  │  │ - Domain control │ │ - All actions    │ │ - Per-user       │    │   │
│  │  │ - Action filter  │ │ - Screenshots    │ │ - Per-domain     │    │   │
│  │  │ - Resource limits│ │ - Full audit    │ │ - Global         │    │   │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Edge Functions Specification

#### 4.2.1 Task Creation Edge Function

```typescript
// supabase/functions/computer-use-create-task/index.ts

/**
 * Computer Use Task Creation Edge Function
 * 
 * Responsibilities:
 * - Validate request
 * - Check credit balance
 * - Create task record
 * - Queue for processing
 * - Return task ID
 * 
 * Credits Calculation:
 * - Base: 1 credit
 * - Per step: 1 credit
 * - Per minute timeout: 1 credit (max 5)
 * - Per screenshot: 1 credit
 */

interface CreateTaskRequest {
  prompt: string;
  max_steps?: number;
  timeout_ms?: number;
  session_id?: string;
  allow_downloads?: boolean;
  allowed_domains?: string[];
  blocked_domains?: string[];
  viewport?: ViewportConfig;
  credentials?: Credentials;
  metadata?: Record<string, string>;
}

interface TaskResponse {
  id: string;
  status: 'pending' | 'queued';
  credits_required: number;
  estimated_duration_ms: number;
}
```

#### 4.2.2 Task Execution Edge Function

```typescript
// supabase/functions/computer-use-execute-task/index.ts

/**
 * Computer Use Task Execution Edge Function
 * 
 * Responsibilities:
 * - Poll for pending tasks
 * - Acquire browser session
 * - Execute task with step-by-step reasoning
 * - Capture screenshots after each action
 * - Handle errors and recovery
 * - Update task status and results
 */

interface ExecutionContext {
  taskId: string;
  prompt: string;
  maxSteps: number;
  timeout: number;
  allowedDomains: string[];
  blockedDomains: string[];
  session: BrowserSession;
  actions: ExecutedAction[];
  screenshots: string[];
}

interface ExecutionStep {
  stepNumber: number;
  reasoning: string;      // LLM reasoning for action
  action: Action;         // Action to execute
  screenshot: string;     // Screenshot after action
  result: ActionResult;   // Success/failure details
}
```

#### 4.2.3 Session Management Edge Function

```typescript
// supabase/functions/computer-use-session/index.ts

/**
 * Computer Use Session Management
 * 
 * Responsibilities:
 * - Create isolated browser sessions
 * - Manage session state (cookies, storage)
 * - Handle session persistence
 * - Clean up expired sessions
 * - Manage browser pool
 */
```

### 4.3 Worker Service Architecture

```yaml
# docker-compose.yml for Worker Services

version: '3.8'

services:
  # Browser Automation Worker
  browser-worker:
    image: agentry/browser-worker:latest
    environment:
      - BROWSER_TYPE=chromium
      - HEADLESS=true
      - MAX_CONCURRENT_SESSIONS=5
      - SESSION_TIMEOUT_MS=1800000
      - SCREENSHOT_QUALITY=80
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 4GiB
    volumes:
      - browser-data:/data
    networks:
      - agentry-internal

  # Task Queue Processor
  task-processor:
    image: agentry/task-processor:latest
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - QUEUE_POLL_INTERVAL=1000
      - MAX_RETRIES=3
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    depends_on:
      - browser-worker
    deploy:
      replicas: 2
    networks:
      - agentry-internal

  # Vision Analysis Service
  vision-analyzer:
    image: agentry/vision-analyzer:latest
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - VISION_MODEL=gpt-4o
    deploy:
      replicas: 2
    networks:
      - agentry-internal

  # Policy Engine
  policy-engine:
    image: agentry/policy-engine:latest
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
    deploy:
      replicas: 1
    networks:
      - agentry-internal

volumes:
  browser-data:

networks:
  agentry-internal:
    driver: bridge
```

---

## 5. Integration Design

### 5.1 Integration with Existing Agentry Platform

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTEGRATION WITH AGENTRY PLATFORM                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    EXISTING AGENTRY SYSTEM                         │   │
│  │                                                                      │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │  Agents     │ │  Councils   │ │   Tasks     │ │  Payments   │   │   │
│  │  │  Catalog   │ │  Manager    │ │  Processor  │ │  (Stripe)   │   │   │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘   │   │
│  │         │               │               │               │          │   │
│  └─────────┼───────────────┼───────────────┼───────────────┼──────────┘   │
│            │               │               │               │              │
│            ▼               ▼               ▼               ▼              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    INTEGRATION POINTS                               │   │
│  │                                                                      │   │
│  │  1. AUTHENTICATION                                                  │   │
│  │     - Use existing Supabase Auth                                    │   │
│  │     - Integrate with current user accounts table                   │   │
│  │     - Credit balance check via user_accounts                       │   │
│  │                                                                      │   │
│  │  2. PAYMENTS                                                        │   │
│  │     - Credits system integration                                    │   │
│  │     - Stripe webhook for purchases                                   │   │
│  │     - Usage-based billing                                            │   │
│  │                                                                      │   │
│  │  3. AGENT INTEGRATION                                              │   │
│  │     - Add Computer Use Agent to agents catalog                      │   │
│  │     - Integrate with Council selection                              │   │
│  │     - Multi-agent collaboration support                             │   │
│  │                                                                      │   │
│  │  4. STORAGE                                                         │   │
│  │     - Use Supabase Storage for screenshots                          │   │
│  │     - Task results and logs                                         │   │
│  │                                                                      │   │
│  │  5. API GATEWAY                                                     │   │
│  │     - Rate limiting (extend existing)                                │   │
│  │     - Request validation                                            │   │
│  │     - Response transformation                                        │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Integration Specifications

#### 5.2.1 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER                                                                        │
│    │                                                                          │
│    ▼                                                                          │
│  ┌──────────────────┐                                                        │
│  │  Login/Register  │                                                        │
│  └────────┬─────────┘                                                        │
│           │                                                                   │
│           ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                    SUPABASE AUTH                                      │    │
│  │  - Email/Password                                                    │    │
│  │  - OAuth (Google, GitHub)                                            │    │
│  │  - Magic Link                                                         │    │
│  └─────────────────────────────┬────────────────────────────────────────┘    │
│                                │                                              │
│                                ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                    SESSION ESTABLISHED                               │    │
│  │  - JWT Token in cookie/storage                                       │    │
│  │  - User ID available for queries                                     │    │
│  └─────────────────────────────┬────────────────────────────────────────┘    │
│                                │                                              │
│                                ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │              COMPUTER USE API ACCESS                                 │    │
│  │                                                                      │    │
│  │  1. Request with JWT                                                │    │
│  │  2. Validate token (Supabase)                                        │    │
│  │  3. Get user_id from token                                           │    │
│  │  4. Check credit balance                                            │    │
│  │  5. Execute task                                                    │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5.2.2 Credit System Integration

```sql
-- Integration with existing credits system

-- Function to check and deduct credits for computer use
CREATE OR REPLACE FUNCTION process_computer_use_credits(
    p_user_id UUID,
    p_task_id UUID,
    p_steps INTEGER,
    p_timeout_ms INTEGER,
    p_screenshots INTEGER
) RETURNS JSONB AS $$
DECLARE
    v_credits_needed INTEGER;
    v_current_balance INTEGER;
    v_success BOOLEAN;
    v_result JSONB;
BEGIN
    -- Calculate required credits
    v_credits_needed := calculate_computer_use_credits(
        p_steps, 
        p_timeout_ms, 
        p_screenshots
    );
    
    -- Get current balance
    SELECT credits INTO v_current_balance
    FROM user_accounts
    WHERE user_id = p_user_id;
    
    -- Check if sufficient
    IF v_current_balance < v_credits_needed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'insufficient_credits',
            'balance', v_current_balance,
            'required', v_credits_needed
        );
    END IF;
    
    -- Deduct credits
    UPDATE user_accounts
    SET credits = credits - v_credits_needed
    WHERE user_id = p_user_id;
    
    -- Log transaction
    INSERT INTO credit_transactions (
        user_id, 
        amount, 
        transaction_type, 
        description,
        reference_id
    )
    VALUES (
        p_user_id,
        -v_credits_needed,
        'computer_use',
        'Computer use task execution',
        p_task_id
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'credits_deducted', v_credits_needed,
        'balance', v_current_balance - v_credits_needed
    );
END;
$$ LANGUAGE plpgsql;
```

#### 5.2.3 Agentry Agent Council Integration

```typescript
// Integration with existing Council system

interface ComputerUseAgent {
  id: string;
  name: string = 'Computer Use Agent';
  specialty: string = 'Browser Automation & Computer Control';
  llm_provider: 'anthropic' | 'openai' = 'anthropic';
  llm_model: string = 'claude-3-5-sonnet-20241022';
  capabilities: string[] = [
    'browser_automation',
    'web_scraping',
    'form_automation',
    'ui_testing',
    'data_extraction'
  ];
  base_price: number = 0.50;  // Higher price for compute-intensive task
}

// Add to existing council processing
// The Computer Use Agent can work alongside other domain agents
// in multi-agent council discussions
```

---

## 6. Security Considerations

### 6.1 Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SECURITY ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         NETWORK SECURITY                            │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │                    FIREWALL RULES                             │   │   │
│  │  │                                                               │   │   │
│  │  │  - Allow: HTTP/HTTPS (80, 443)                               │   │   │
│  │  │  - Allow: WebSocket (443)                                    │   │   │
│  │  │  - Allow: Supabase API (443)                                │   │   │
│  │  │  - Deny: All other outbound                                 │   │   │
│  │  │  - Allowlist: Specific API domains                          │   │   │
│  │  │  - Block: Sensitive sites (banking, government)              │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      BROWSER SANDBOXING                             │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │                  BROWSER ISOLATION                            │   │   │
│  │  │                                                               │   │   │
│  │  │  - Isolated browser context per session                      │   │   │
│  │  │  - No access to host file system                             │   │   │
│  │  │  - Restricted network access (proxy)                         │   │   │
│  │  │  - No access to system clipboard (configurable)             │   │   │
│  │  │  - No access to microphone/camera                             │   │   │
│  │  │  - Downloads to isolated temp directory                      │   │   │
│  │  │  - JavaScript execution limits                                │   │   │
│  │  │  - No access to localStorage/cookies across sessions        │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DATA SECURITY                              │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │                  ENCRYPTION & PROTECTION                       │   │   │
│  │  │                                                               │   │   │
│  │  │  - Credentials: AES-256 encryption at rest                   │   │   │
│  │  │  - Screenshots: Stored in encrypted bucket                  │   │   │
│  │  │  - Audit logs: Immutable                                      │   │   │
│  │  │  - PII: Redacted from logs                                   │   │   │
│  │  │  - TLS 1.3 for all API communications                       │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      ACCESS CONTROL                                │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │                     RBAC & PERMISSIONS                         │   │   │
│  │  │                                                               │   │   │
│  │  │  - Role-based access control (Admin, User, Guest)            │   │   │
│  │  │  - Per-user resource quotas                                  │   │   │
│  │  │  - Domain allowlist/blocklist per user                       │   │   │
│  │  │  - API key management                                         │   │   │
│  │  │  - Session timeout policies                                   │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Domain Blocklist (Default)

```sql
-- Default blocked domains for security
INSERT INTO computer_use_policy_rules (name, description, rule_type, condition, effect, priority, is_global, is_active)
VALUES 
    -- Financial & Government
    ('Block Financial Sites', 'Prevent access to banking and financial sites', 'domain', 
     '{"category": "banking"}', 'deny', 100, true, true),
    
    ('Block Government Sites', 'Prevent access to government sites', 'domain',
     '{"category": "government"}', 'deny', 100, true, true),
    
    -- Sensitive Data
    ('Block Email Providers', 'Prevent access to email providers', 'domain',
     '{"domains": ["gmail.com", "outlook.com", "yahoo.com", "mail.com"]}', 'deny', 90, true, true),
    
    ('Block Social Media Login', 'Prevent login to social media', 'domain',
     '{"domains": ["facebook.com", "twitter.com", "instagram.com", "linkedin.com"]}', 'warn', 50, true, true),
    
    -- High-Risk Actions
    ('Block File Downloads by Default', 'Require explicit permission for downloads', 'action',
     '{"action": "download"}', 'deny', 80, true, true),
    
    ('Block External Payments', 'Prevent payment operations', 'action',
     '{"action": "payment"}', 'deny', 90, true, true),
    
    -- Rate Limiting
    ('Rate Limit High Frequency', 'Prevent excessive API calls', 'rate_limit',
     '{"max_per_minute": 10, "max_per_hour": 100}', 'rate_limit', 70, true, true);
```

### 6.3 Audit Trail Schema

```sql
-- Comprehensive audit logging for compliance

-- Create audit logs for every action
CREATE OR REPLACE FUNCTION log_computer_use_action()
RETURNS TRIGGER AS $$
BEGIN
    -- Log to audit table
    INSERT INTO computer_use_audit_logs (
        user_id,
        ip_address,
        user_agent,
        action_type,
        resource_type,
        resource_id,
        action_details,
        success,
        task_id,
        session_id,
        request_id
    )
    VALUES (
        NEW.user_id,
        COALESCE(current_setting('app.current_ip', true), '0.0.0.0')::inet,
        current_setting('app.current_user_agent', true),
        CASE 
            WHEN TG_OP = 'INSERT' THEN 'create'
            WHEN TG_OP = 'UPDATE' THEN 'update'
            WHEN TG_OP = 'DELETE' THEN 'delete'
        END,
        TG_TABLE_NAME,
        NEW.id,
        to_jsonb(NEW),
        true,
        NEW.id,
        NEW.session_id,
        gen_random_uuid()
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit triggers
CREATE TRIGGER audit_computer_use_tasks
    AFTER INSERT OR UPDATE OR DELETE ON computer_use_tasks
    FOR EACH ROW EXECUTE FUNCTION log_computer_use_action();

CREATE TRIGGER audit_computer_use_actions
    AFTER INSERT ON computer_use_actions
    FOR EACH ROW EXECUTE FUNCTION log_computer_use_action();
```

---

## 7. Deployment Strategy

### 7.1 Infrastructure Overview

```yaml
# Infrastructure Configuration

environment: production
region: us-east-1

services:
  # Supabase (Managed)
  supabase:
    plan: pro
    region: us-east-1
    
  # Browser Workers (Self-hosted)
  browser_workers:
    provider: aws  # or gcp, azure
    instance_type: t3.large
    min_replicas: 2
    max_replicas: 10
    auto_scaling:
      metric: cpu_utilization
      target: 70
    
  # Task Queue (Redis)
  redis:
    provider: aws_elasti_cache
    node_type: cache.t3.micro
    num_nodes: 2
    
  # CDN (CloudFront)
  cdn:
    provider: aws_cloudfront
    cache_policy: aggressive
    
  # Monitoring (DataDog)
  monitoring:
    provider: datadog
    apm_enabled: true
    logs_enabled: true
```

### 7.2 Deployment Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEPLOYMENT PHASES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 1: Foundation (Week 1-2)                                             │
│  ─────────────────────────────                                              │
│  - Set up browser worker infrastructure                                    │
│  - Configure Supabase database migrations                                   │
│  - Deploy core edge functions                                               │
│  - Set up monitoring and logging                                            │
│  - Security audit and penetration testing                                   │
│                                                                             │
│  PHASE 2: Core Features (Week 3-4)                                          │
│  ─────────────────────────────                                              │
│  - Task creation and execution flow                                         │
│  - Session management                                                        │
│  - Basic action execution (click, type, navigate)                          │
│  - Screenshot capture and storage                                            │
│  - Credit system integration                                                 │
│                                                                             │
│  PHASE 3: Advanced Features (Week 5-6)                                      │
│  ─────────────────────────────                                              │
│  - Vision-based element detection                                           │
│  - LLM-powered action planning                                               │
│  - Error recovery and retry logic                                            │
│  - Action templates                                                          │
│  - Rate limiting and quotas                                                  │
│                                                                             │
│  PHASE 4: Integration (Week 7-8)                                             │
│  ─────────────────────────────                                              │
│  - Agentry platform integration                                              │
│  - Council multi-agent support                                               │
│  - API documentation and client SDKs                                        │
│  - Webhook support                                                           │
│                                                                             │
│  PHASE 5: Launch (Week 9-10)                                                 │
│  ─────────────────────────────                                              │
│  - Beta user onboarding                                                      │
│  - Performance optimization                                                  │
│  - Documentation and tutorials                                               │
│  - Marketing launch                                                          │
│                                                                             │
│  PHASE 6: Compliance (Week 11-12)                                            │
│  ─────────────────────────────                                              │
│  - SOC 2 Type II preparation                                                 │
│  - GDPR compliance audit                                                     │
│  - Security hardening                                                        │
│  - Penetration testing                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Monitoring & Observability

```yaml
# Monitoring Configuration

metrics:
  - task_completion_rate
  - average_execution_time
  - error_rate_by_type
  - credit_consumption
  - active_sessions
  - browser_worker_utilization
  
alerts:
  - critical:
      - error_rate > 5%
      - task_timeout > 10%
      - worker_cpu > 90%
  - warning:
      - error_rate > 1%
      - credit_balance_low
      - session_queue_backlog

logging:
  levels:
    - ERROR: All errors
    - WARN: Warnings and above
    - INFO: Task lifecycle
    - DEBUG: Detailed execution
  
  retention:
    - 30 days (hot storage)
    - 1 year (cold storage)
```

---

## 8. Task Breakdown Summary

| Phase | Tasks | Hours | Key Deliverables |
|-------|-------|-------|------------------|
| Phase 1: API Integration | 8 | 160 | Core API, Database Schema, Auth |
| Phase 2: Custom Implementation | 8 | 160 | Browser Workers, Action Execution |
| Phase 3: Agentry Integration | 6 | 120 | Platform Integration, Council Support |
| Phase 4: Safety & Compliance | 4 | 40 | Security, Audit, Compliance |
| **Total** | **26** | **480** | |

---

## 9. Acceptance Criteria

### 9.1 Functional Requirements

- [ ] Users can create computer use tasks via API
- [ ] Tasks execute in isolated browser sessions
- [ ] Screenshots captured after each action
- [ ] Credit system correctly deducts usage
- [ ] Domain allow/block lists enforced
- [ ] Session state persists across requests
- [ ] Error handling with retry logic
- [ ] Full audit trail for compliance

### 9.2 Non-Functional Requirements

- [ ] Task execution < 2 minutes for 20 steps
- [ ] 99.5% uptime
- [ ] < 0.1% false positive security blocks
- [ ] SOC 2 Type II compliant
- [ ] GDPR compliant data handling
- [ ] < 100ms API response time

---

**Document End**
