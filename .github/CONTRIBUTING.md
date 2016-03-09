# How to Contribute

Third Party contributions to lambda-tools are more than welcome! However, in order to maintain the style and functionality of the codebase, all contributions should follow a specific procedure when proposing or implementing new features or filing bug reports. It is worth noting, these guidelines are meant to help us manage contributions, not limit anyone from contributing, so feel free to also propose changes to these very guidelines if something seems wrong.

## Getting Started

All contributions should come through our [GitHub repository](https://github.com/testlio/lambda-tools) and should begin with you filing an issue (assuming one doesn't already exist).

## Pull Requests

All Pull Requests submitted to this repository should make use of the template provided in [PULL_REQUEST_TEMPLATE.md](/PULL_REQUEST_TEMPLATE.md). The template includes a checklist, which should be checked off before submitting and which will be used to evaluate the quality of the Pull Request.

## Issues

All Issues filed to this repository should make use of the template provided in [ISSUE_TEMPLATE.md](/ISSUE_TEMPLATE.md). The template includes sections in angle brackets `<>`, which should be replaced by your input. Furthermore, there are parts to the Issue that are only applicable to bugs or feature proposals. These are again, marked with angle brackets and the non-applicable section to your change should be removed.

## Submitting Changes

### Documentation Improvements

For fixes to the documentation, including README, this guideline or comments in code, no issue needs to be submitted. Instead, you should simply fork this repository, make the changes and submit a Pull Request. In the Pull Request, clearly indicate what was changed and why.

### Bug Reports

If the issue is related to a bug report, make sure to include the following information:

1. Version of lambda-tools the bug occurs on (always check against latest)
2. Environment you are working with (minimally Node version and OS)
2. Steps to reproduce the problem
3. Expected outcome
4. Actual outcome

### Feature Proposals / Improvements

If you wish to see/add a feature to lambda-tools, you should also start by filing an issue (once again verifying that a matching one doesn't already exist). The issue should clearly describe the desired functionality by including:

1. Description of the functionality
2. How it is surfaced to the user (new command, new option etc.)
3. Example use of the functionality
4. How the feature can be tested

When you decide to contribute by implementing any of the proposed features, do so by forking this repository, once you have completed the work, submit a Pull Request back to this repository. All Pull Requests should refer back to the issue they are addressing, Pull Requests that are not linkable/linked to an issue will likely not be merged.

Pull Requests may receive feedback from the development team, proposing changes or asking further questions about the changes. Please try to respond to this feedback, as otherwise it the changes will likely not be merged.
