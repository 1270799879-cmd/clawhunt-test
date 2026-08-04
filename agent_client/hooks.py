app_name = "agent_client"
app_title = "Agent Client"
app_publisher = "Agent Client"
app_description = "Super-intelligent agent interaction client"
app_icon = "octicon octicon-bot"
app_color = "grey"
source_link = "https://github.com/agent-client/agent_client"
app_license = "MIT"

after_install = "agent_client.setup.install.after_install"

# Includes in <head>
app_include_css = []
app_include_js = []

# Web-forms
web_forms = []

# Fixtures
fixtures = []

# Permissions
permission_query_conditions = {}

# Email
outgoing_email_account = ""

# Scheduler jobs
scheduler_events = {
    "cron": {
        "hourly": ["agent_client.agent_client.tasks.scheduled_evolution"],
    },
}

# Jinja
jinja = {}

# Accounts
accounts = {}

# User defined fields
custom_fields = {}

# DocType class overrides
override_whitelisted_methods = {}

# DocType methods
doc_events = {}

# Custom Jinja templates
app_include_jinja = []

# website
website_route_rules = []
