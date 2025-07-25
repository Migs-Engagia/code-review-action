const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

let techStack = {
  language: "PHP 7.1 and Android Kotlin/Java",
  framework: "CakePHP 3.3 and Android SDK",
}; //default configuration, can be overridden by user input
let strictMode = false; // default to false, can be set by user input

async function callChatGPT(apiKey, content) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    model: "gpt-4o-mini", // Use the latest model available
    messages: [
      {
        role: "user",
        content: content
      }
    ],
    max_tokens: 4096, // Adjust as needed
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`ChatGPT API request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  core.info("gpt response : " + result);
  return result.choices[0]?.message?.content ?? "(No response)";
}

async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const apiKey = core.getInput("chatgpt-api-key");
    const octokit = github.getOctokit(token);
    const context = github.context;
    setupInput();

    if (context.eventName !== "pull_request") {
      core.setFailed("This action only runs on pull_request events.");
      return;
    }

    const { owner, repo } = context.repo;
    const pull_number = context.payload.pull_request.number;
    const base = context.payload.pull_request.base.sha;
    const head = context.payload.pull_request.head.sha;

     // Get list of changed files
     const { data: compare } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base,
      head
    });

    const changedFiles = compare.files.map(file => file.filename);

    // Define excluded paths
    const excludedPaths = [
      "README.md",
      ".github/",
    ];

    const isExcluded = (file) =>
      excludedPaths.some(excluded =>
        file === excluded || file.startsWith(excluded)
      );

    const filteredFiles = changedFiles.filter(file => !isExcluded(file));

    if (filteredFiles.length === 0) {
      core.info("All changed files are excluded. Skipping ChatGPT review.");

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: `✅ **No code review needed**\n\nAll changed files are in excluded paths, so no review was performed.`
      });

      return;
    }

    // Get the diff between base and head
    const { data: diff } = await octokit.request("GET /repos/{owner}/{repo}/compare/{base}...{head}", {
      owner,
      repo,
      base,
      head,
      headers: {
        accept: "application/vnd.github.v3.diff"
      }
    });

    const prompt = {
      role: "You are a senior software engineer.",
      task: "Review the following code diff based on best practices.",
      platform: "backend",
      technology: techStack,
      checklist: {
        codeQuality: {
          readabilityAndMaintainability: [
            "Code follows the team's coding style and conventions.",
            "Code is well-documented (e.g., inline comments, README).",
            "Variable and function names are clear and descriptive.",
            "No commented-out code unless intended for future use."
          ],
          codeStructure: [
            "Code is logically organized and modular.",
            "Functions and methods are not excessively long.",
            "Indentation and whitespace are used effectively for readability."
          ],
          errorHandling: [
            "Appropriate error-handling mechanisms are in place.",
            "Error messages are clear, informative, and actionable."
          ]
        },
        functionalityAndLogic: {
          correctness: [
            "Code meets the intended functionality and requirements.",
            "No logical errors or unexpected behavior.",
            "Edge cases and boundary conditions are handled appropriately."
          ],
          testCoverage: [
            "Unit tests are provided for new or modified code.",
            "Existing tests remain functional.",
            "Tests cover a range of scenarios, including edge cases."
          ]
        },
        performance: [
          "Code is optimized where necessary.",
          "Redundant or unnecessary computations are avoided.",
          "Scalability considerations are taken into account."
        ],
        security: [
          "Secure coding practices are followed.",
          "User inputs are properly validated and sanitized.",
          "Sensitive data is handled securely."
        ],
        documentation: [
          "API documentation is updated (if applicable).",
          "README or relevant documentation is up to date.",
          "External dependencies and configurations are clearly documented."
        ],
        commentsAndSuggestions: [
          "Constructive feedback is provided to the author.",
          "Suggestions for improvement are clear and actionable.",
          "Potential issues or concerns are flagged for discussion."
        ],
        overallApproval: [
          "Approved – Meets all criteria and is ready to merge.",
          "Approved with minor changes – Minor adjustments are needed.",
          "Request for clarification – Additional context or explanation is required.",
          "Changes required – Significant revisions are needed before approval.",
          "Rejected – Does not meet quality standards and needs major rework."
        ]
      },
      instruction: "After reviewing the diff, respond using the following JSON format: { status: 'PASS' or 'FAIL', issues: [...], suggestedImprovements: [...] }",
      input: {
        diff: diff,
      }
    };

    const chatGPTResponse = await callChatGPT(apiKey, JSON.stringify(prompt, null, 2));

    // Post the response as a comment
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: `🧠 **ChatGPT Code Review (Experimental)**\n\n\`\`\`json\n${chatGPTResponse}\n\`\`\``
    });

    if(strictMode) {
      // If strict mode is enabled, fail the action if ChatGPT suggests issues
      const responseJson = JSON.parse(chatGPTResponse);
      if (responseJson.status === 'FAIL' || responseJson.issues.length > 0) {
        core.setFailed("ChatGPT review failed with issues: " + JSON.stringify(responseJson.issues));
        return;
      }
    }

    core.setOutput("chatgpt_review", chatGPTResponse);
    core.info("ChatGPT review comment posted!");
  } catch (error) {
    core.setFailed(error.message);
  }
}

function setupInput(){
  if (!!core.getInput('custom_tech_stack')) {
    tags = JSON.parse(core.getInput('custom_tech_stack'));
  }

  if( !!core.getInput('strict_mode')) {
    strictMode = core.getInput('strict_mode').toLowerCase() === 'true';
  }
}

run();