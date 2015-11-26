# Lambda tools

This repository contains a set of scripts that are useful when developing [AWS Lambda](https://aws.amazon.com/lambda/) backed microservices that rely on [AWS CloudFormation](https://aws.amazon.com/cloudformation/) and [AWS API Gateway](https://aws.amazon.com/api-gateway/).

## Deploy - `deploy`

Deployment of a service to AWS, goes through multiple steps during the process:
1. Locally processes Lambda functions, using [browserify](http://browserify.org) and [uglify](https://github.com/mishoo/UglifyJS) to optimise the performance of the resulting functions
2. Generates a CloudFormation template that is used to raise/update a stack on AWS
3. Parses a [Swagger](http://swagger.io) definition for an API, autocompleting Lambda function ARNs and Lambda role ARNs
4. Creates/Updates and deploys a REST API on API Gateway using definition built in (3.)

### Usage

```
deploy -n project-name [-s stage-to-deploy] [-r aws-region-to-deploy-to]
```

Additional arguments can be looked up by calling `deploy -h`

### Authentication

`deploy` assumes you have configured AWS credentials [that can be reached by the script](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html#Setting_AWS_Credentials). The script uses AWS SDK for Node.js, which is able to automatically pick up credentials from various places, thus, the script itself does not allow modifying/storing credentials.

### Notes about microservice structure

In order for the `deploy` script to work properly, the following structure is assumed for a microservice

```
Root Directory of the service
| api.json  - Swagger definition of the API to expose (optional)
| cf.json   - CloudFormation template for any additional resources or overrides
| lambda_policies.json - Additional AWS IAM policies for the Lambda functions (optional)
| package.json - By default all services are assumed to be NPM packages
| lambdas   - Directory containing Lambda functions, all subdirectories are treated as a function
    | lambda_name - Name of the directory is used as the name for the Lambda function
        | *.js    - JS files making up the Lambda function (default assumes index.js exists)
        | cf.json - Overrides for properties that are defined on Lambda function (allows overriding default index.js handler)
    | ...
```

As all Lambda functions are bundled and compressed during deployment, it is safe to share common code between Lambda functions in the top level of the microservice, for example in a directory called `common` or `lib`.

#### Examples

A minimal example of a service is implemented under [`examples/microservice`](examples/microservice), for more complex examples, look at [bulletin-service](https://github.com/testlio/bulletin-service).
