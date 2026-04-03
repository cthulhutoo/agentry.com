"""SendGrid email service for Agentry notifications."""

from __future__ import annotations

import logging
import os

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, ReplyTo

logger = logging.getLogger(__name__)

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "hello@agentry.com")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "ryan@middlestate.com")
REPLY_TO_EMAIL = os.getenv("REPLY_TO_EMAIL", ADMIN_EMAIL)


def _get_client() -> SendGridAPIClient | None:
    """Return SendGrid client, or None if not configured."""
    if not SENDGRID_API_KEY:
        logger.warning("SENDGRID_API_KEY not set — emails disabled.")
        return None
    return SendGridAPIClient(api_key=SENDGRID_API_KEY)


async def send_intake_confirmation(form_data: dict) -> bool:
    """Send confirmation email to the person who submitted the broker form."""
    client = _get_client()
    if not client:
        return False

    to_email = form_data.get("email", "")
    if not to_email:
        logger.warning("No email in form data, skipping confirmation.")
        return False

    business_name = form_data.get("business_name", "your company")
    needs = form_data.get("needs", "your requirements")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #0d1117; font-size: 24px; margin: 0;">AGENTRY</h1>
        <p style="color: #3dbbc4; font-size: 14px; margin: 4px 0 0;">The Registry for the Agent Economy</p>
      </div>
      
      <h2 style="color: #0d1117; font-size: 20px;">We received your request!</h2>
      
      <p style="color: #333; line-height: 1.6;">
        Hi <strong>{business_name}</strong>,
      </p>
      
      <p style="color: #333; line-height: 1.6;">
        Thanks for submitting your agent matching request. Our team is reviewing your needs and will match you with the best AI agent within <strong>24 hours</strong>.
      </p>
      
      <div style="background: #f6f8fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #0d1117; font-size: 14px; margin: 0 0 12px;">Your Request Summary</h3>
        <p style="color: #555; font-size: 14px; line-height: 1.5; margin: 0;">
          <strong>Business:</strong> {business_name}<br>
          <strong>Type:</strong> {form_data.get('business_type', 'N/A')}<br>
          <strong>Budget:</strong> {form_data.get('budget', 'N/A')}<br>
          <strong>Needs:</strong> {needs}
        </p>
      </div>
      
      <p style="color: #333; line-height: 1.6;">
        In the meantime, feel free to browse our <a href="https://agentry.com/#directory" style="color: #3dbbc4;">agent directory</a> to explore options.
      </p>
      
      <p style="color: #999; font-size: 12px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
        &copy; Agentry &mdash; The Registry for the Agent Economy<br>
        <a href="https://agentry.com" style="color: #3dbbc4;">agentry.com</a>
      </p>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry"),
        to_emails=to_email,
        subject="We're matching you with an AI agent — Agentry",
        html_content=html_body,
    )

    try:
        message.reply_to = ReplyTo(REPLY_TO_EMAIL, "Agentry")
        response = client.send(message)
        logger.info("Confirmation email sent to %s (status: %s)", to_email, response.status_code)
        return response.status_code in (200, 201, 202)
    except Exception as e:
        logger.error("Failed to send confirmation email: %s", e)
        return False


async def send_admin_notification(form_data: dict) -> bool:
    """Notify Ryan about a new broker intake submission."""
    client = _get_client()
    if not client:
        return False

    business_name = form_data.get("business_name", "Unknown")
    email = form_data.get("email", "N/A")
    business_type = form_data.get("business_type", "N/A")
    budget = form_data.get("budget", "N/A")
    needs = form_data.get("needs", "N/A")
    tools = form_data.get("tools", "N/A")
    urgency = form_data.get("urgency", "N/A")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #0d1117; font-size: 20px;">New Broker Intake Submission</h2>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666; width: 140px;"><strong>Business</strong></td>
          <td style="padding: 10px 0; color: #333;">{business_name}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Email</strong></td>
          <td style="padding: 10px 0; color: #333;"><a href="mailto:{email}" style="color: #3dbbc4;">{email}</a></td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Type</strong></td>
          <td style="padding: 10px 0; color: #333;">{business_type}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Budget</strong></td>
          <td style="padding: 10px 0; color: #333;">{budget}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Urgency</strong></td>
          <td style="padding: 10px 0; color: #333;">{urgency}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Current Tools</strong></td>
          <td style="padding: 10px 0; color: #333;">{tools}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #666; vertical-align: top;"><strong>Needs</strong></td>
          <td style="padding: 10px 0; color: #333;">{needs}</td>
        </tr>
      </table>
      
      <a href="https://api.agentry.com/docs" style="display: inline-block; background: #3dbbc4; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">View in API Dashboard</a>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry Alerts"),
        to_emails=ADMIN_EMAIL,
        subject=f"New Lead: {business_name} — {business_type}",
        html_content=html_body,
    )

    try:
        message.reply_to = ReplyTo(REPLY_TO_EMAIL, "Agentry")
        response = client.send(message)
        logger.info("Admin notification sent (status: %s)", response.status_code)
        return response.status_code in (200, 201, 202)
    except Exception as e:
        logger.error("Failed to send admin notification: %s", e)
        return False

# --- Addition to email_service.py: Developer agent registration emails ---

async def send_agent_registration_confirmation(agent_data: dict) -> bool:
    """Send confirmation email to the developer who registered an agent."""
    client = _get_client()
    if not client:
        return False

    to_email = agent_data.get("contact_email", "")
    if not to_email:
        logger.warning("No contact email for agent registration, skipping confirmation.")
        return False

    agent_name = agent_data.get("name", "your agent")
    agent_url = agent_data.get("url", "")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #0d1117; font-size: 24px; margin: 0;">AGENTRY</h1>
        <p style="color: #3dbbc4; font-size: 14px; margin: 4px 0 0;">The Registry for the Agent Economy</p>
      </div>

      <h2 style="color: #0d1117; font-size: 20px;">Your agent has been submitted.</h2>

      <p style="color: #333; line-height: 1.6;">
        Thanks for registering <strong>{agent_name}</strong> on Agentry. Our team will review your listing and it will appear in the directory shortly.
      </p>

      <div style="background: #f6f8fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #0d1117; font-size: 14px; margin: 0 0 12px;">Listing Summary</h3>
        <p style="color: #555; font-size: 14px; line-height: 1.5; margin: 0;">
          <strong>Agent:</strong> {agent_name}<br>
          <strong>URL:</strong> {agent_url}<br>
          <strong>Category:</strong> {agent_data.get('category', 'N/A')}<br>
          <strong>A2A Support:</strong> {agent_data.get('a2a_support', 'Unknown')}
        </p>
      </div>

      <div style="background: linear-gradient(135deg, rgba(1,212,219,0.08), rgba(1,105,111,0.08)); border: 1px solid rgba(1,212,219,0.2); border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #0d1117; font-size: 16px; margin: 0 0 12px;">
          <span style="margin-right: 8px;">&#x1F6E1;</span> Boost Your Trust Score
        </h3>
        <p style="color: #333; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
          Agents with higher trust scores rank higher in search results and get more visibility. Here's how to improve yours:
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
            <td style="padding: 8px 0; color: #3dbbc4; width: 30px; vertical-align: top; font-weight: bold;">+25</td>
            <td style="padding: 8px 0; color: #333;"><strong>Host an A2A Agent Card</strong> &mdash; Serve a valid JSON at <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">/.well-known/agent.json</code> on your domain. <a href="https://google.github.io/A2A/" style="color: #3dbbc4;">See the spec &rarr;</a></td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
            <td style="padding: 8px 0; color: #3dbbc4; font-weight: bold;">+15</td>
            <td style="padding: 8px 0; color: #333;"><strong>Add provider info</strong> &mdash; Include your org name and URL in the agent card's <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">provider</code> field.</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
            <td style="padding: 8px 0; color: #3dbbc4; font-weight: bold;">+15</td>
            <td style="padding: 8px 0; color: #333;"><strong>Define skills</strong> &mdash; List at least one skill with an ID, name, and description.</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
            <td style="padding: 8px 0; color: #3dbbc4; font-weight: bold;">+10</td>
            <td style="padding: 8px 0; color: #333;"><strong>Add authentication</strong> &mdash; Declare your auth scheme (API key, OAuth, etc.).</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
            <td style="padding: 8px 0; color: #3dbbc4; font-weight: bold;">+10</td>
            <td style="padding: 8px 0; color: #333;"><strong>Set version fields</strong> &mdash; Include <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">version</code> and <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">protocolVersion</code>.</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #3dbbc4; font-weight: bold;">+25</td>
            <td style="padding: 8px 0; color: #333;"><strong>Stay online</strong> &mdash; We check your agent every 6 hours. Consistent uptime and fast response times earn the highest scores.</td>
          </tr>
        </table>
      </div>

      <p style="color: #333; line-height: 1.6;">
        We'll automatically scan your URL for an A2A Agent Card and update your trust score. You can check your listing status anytime at <a href="https://agentry.com/#directory" style="color: #3dbbc4;">agentry.com</a>.
      </p>

      <p style="color: #999; font-size: 12px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
        &copy; Agentry &mdash; The Registry for the Agent Economy<br>
        <a href="https://agentry.com" style="color: #3dbbc4;">agentry.com</a>
      </p>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry"),
        to_emails=to_email,
        subject=f"Your agent \"{agent_name}\" is listed — boost your trust score",
        html_content=html_body,
    )

    try:
        message.reply_to = ReplyTo(REPLY_TO_EMAIL, "Agentry")
        response = client.send(message)
        logger.info("Agent registration email sent to %s (status: %s)", to_email, response.status_code)
        return response.status_code in (200, 201, 202)
    except Exception as e:
        logger.error("Failed to send agent registration email: %s", e)
        return False


async def send_agent_registration_admin(agent_data: dict) -> bool:
    """Notify admin about a new agent registration."""
    client = _get_client()
    if not client:
        return False

    agent_name = agent_data.get("name", "Unknown")
    contact_email = agent_data.get("contact_email", "N/A")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #0d1117; font-size: 20px;">New Agent Registration</h2>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666; width: 140px;"><strong>Agent</strong></td>
          <td style="padding: 10px 0; color: #333;">{agent_name}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>URL</strong></td>
          <td style="padding: 10px 0; color: #333;"><a href="{agent_data.get('url', '#')}" style="color: #3dbbc4;">{agent_data.get('url', 'N/A')}</a></td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Contact</strong></td>
          <td style="padding: 10px 0; color: #333;"><a href="mailto:{contact_email}" style="color: #3dbbc4;">{contact_email}</a></td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Category</strong></td>
          <td style="padding: 10px 0; color: #333;">{agent_data.get('category', 'N/A')}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Pricing</strong></td>
          <td style="padding: 10px 0; color: #333;">{agent_data.get('pricing_model', 'N/A')} — {agent_data.get('starting_price', 'N/A')}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>A2A</strong></td>
          <td style="padding: 10px 0; color: #333;">{agent_data.get('a2a_support', 'Unknown')}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>MCP</strong></td>
          <td style="padding: 10px 0; color: #333;">{agent_data.get('mcp_support', 'Unknown')}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #666; vertical-align: top;"><strong>Description</strong></td>
          <td style="padding: 10px 0; color: #333;">{agent_data.get('description', 'N/A')}</td>
        </tr>
      </table>

      <a href="https://api.agentry.com/docs" style="display: inline-block; background: #3dbbc4; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">Review in API</a>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry Alerts"),
        to_emails=ADMIN_EMAIL,
        subject=f"New Agent Listed: {agent_name}",
        html_content=html_body,
    )

    try:
        message.reply_to = ReplyTo(REPLY_TO_EMAIL, "Agentry")
        response = client.send(message)
        logger.info("Agent registration admin notification sent (status: %s)", response.status_code)
        return response.status_code in (200, 201, 202)
    except Exception as e:
        logger.error("Failed to send agent registration admin email: %s", e)
        return False


async def send_trust_score_outreach(agent_data: dict) -> bool:
    """Send trust score improvement outreach to an existing agent's contact."""
    client = _get_client()
    if not client:
        return False

    to_email = agent_data.get("contact_email", "")
    if not to_email:
        return False

    agent_name = agent_data.get("name", "your agent")
    agent_url = agent_data.get("url", "")
    trust_score = agent_data.get("trust_score", 0)
    trust_tier = agent_data.get("trust_tier", "unverified")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #0d1117; font-size: 24px; margin: 0;">AGENTRY</h1>
        <p style="color: #3dbbc4; font-size: 14px; margin: 4px 0 0;">The Registry for the Agent Economy</p>
      </div>

      <h2 style="color: #0d1117; font-size: 20px;">{agent_name} is listed on Agentry &mdash; claim your profile</h2>

      <p style="color: #333; line-height: 1.6;">
        Hi there &mdash; we're reaching out because <strong>{agent_name}</strong> is listed in the <a href="https://agentry.com/#directory" style="color: #3dbbc4;">Agentry directory</a>, the protocol-aware registry for AI agents.
      </p>

      <div style="background: #f6f8fa; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="color: #666; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">Current Trust Score</p>
        <p style="color: #0d1117; font-size: 48px; font-weight: 700; margin: 0;">{int(trust_score)}</p>
        <p style="color: {'#e5534b' if trust_tier == 'unverified' else '#3dbbc4'}; font-size: 14px; font-weight: 600; margin: 4px 0 0; text-transform: uppercase;">{trust_tier}</p>
      </div>

      <p style="color: #333; line-height: 1.6;">
        Verified agents with higher trust scores get <strong>more visibility</strong> in our directory and <strong>rank higher</strong> in search results. Businesses use trust scores to decide which agents to evaluate.
      </p>

      <p style="color: #333; line-height: 1.6; font-weight: 600;">
        Here's how to boost your score:
      </p>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
        <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
          <td style="padding: 10px 0; color: #3dbbc4; width: 36px; vertical-align: top; font-weight: bold;">+25</td>
          <td style="padding: 10px 0; color: #333;"><strong>Host an A2A Agent Card</strong><br><span style="color: #666;">Serve a JSON file at <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">{agent_url}/.well-known/agent.json</code></span></td>
        </tr>
        <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
          <td style="padding: 10px 0; color: #3dbbc4; font-weight: bold;">+15</td>
          <td style="padding: 10px 0; color: #333;"><strong>Add provider info</strong><br><span style="color: #666;">Include your org name and URL in the card's <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">provider</code> field</span></td>
        </tr>
        <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
          <td style="padding: 10px 0; color: #3dbbc4; font-weight: bold;">+15</td>
          <td style="padding: 10px 0; color: #333;"><strong>Define skills</strong><br><span style="color: #666;">List at least one skill with ID, name, and description</span></td>
        </tr>
        <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
          <td style="padding: 10px 0; color: #3dbbc4; font-weight: bold;">+10</td>
          <td style="padding: 10px 0; color: #333;"><strong>Declare authentication</strong><br><span style="color: #666;">Specify your auth scheme (API key, OAuth, bearer token)</span></td>
        </tr>
        <tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">
          <td style="padding: 10px 0; color: #3dbbc4; font-weight: bold;">+10</td>
          <td style="padding: 10px 0; color: #333;"><strong>Set version fields</strong><br><span style="color: #666;">Include <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">version</code> and <code style="background: rgba(1,212,219,0.1); padding: 1px 4px; border-radius: 3px;">protocolVersion</code></span></td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #3dbbc4; font-weight: bold;">+25</td>
          <td style="padding: 10px 0; color: #333;"><strong>Stay online</strong><br><span style="color: #666;">We check every 6 hours. Uptime and response speed earn points</span></td>
        </tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="https://google.github.io/A2A/" style="display: inline-block; background: #3dbbc4; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Read the A2A Spec &rarr;</a>
      </div>

      <p style="color: #333; line-height: 1.6;">
        We scan your agent card automatically every 6 hours. Once you've set it up, your trust score will update within a day &mdash; no action needed on your end.
      </p>

      <p style="color: #333; line-height: 1.6;">
        Questions? Just reply to this email.
      </p>

      <p style="color: #999; font-size: 12px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
        &copy; Agentry &mdash; The Registry for the Agent Economy<br>
        <a href="https://agentry.com" style="color: #3dbbc4;">agentry.com</a><br>
        <span style="color: #bbb;">You received this because {agent_name} is listed in the Agentry directory.</span>
      </p>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry"),
        to_emails=to_email,
        subject=f"{agent_name}'s trust score is {int(trust_score)} — here's how to improve it",
        html_content=html_body,
    )

    try:
        message.reply_to = ReplyTo(REPLY_TO_EMAIL, "Agentry")
        response = client.send(message)
        logger.info("Trust outreach sent to %s for %s (status: %s)", to_email, agent_name, response.status_code)
        return response.status_code in (200, 201, 202)
    except Exception as e:
        logger.error("Failed to send trust outreach: %s", e)
        return False
