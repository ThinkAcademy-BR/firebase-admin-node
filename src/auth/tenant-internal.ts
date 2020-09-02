/*!
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as validator from '../utils/validator';
import { AuthClientErrorCode, FirebaseAuthError } from '../utils/error';
import { TenantOptions } from './tenant';
import { MultiFactorAuthServerConfig } from './auth-config-internal';
import {
  EmailSignInConfigServerRequest, EmailSignInConfig, MultiFactorAuthConfig
} from './auth-config-internal';

/** The corresponding server side representation of a TenantOptions object. */
export interface TenantOptionsServerRequest extends EmailSignInConfigServerRequest {
  displayName?: string;
  mfaConfig?: MultiFactorAuthServerConfig;
  testPhoneNumbers?: { [key: string]: string };
}

/** The tenant server response interface. */
export interface TenantServerResponse {
  name: string;
  displayName?: string;
  allowPasswordSignup?: boolean;
  enableEmailLinkSignin?: boolean;
  mfaConfig?: MultiFactorAuthServerConfig;
  testPhoneNumbers?: { [key: string]: string };
}

export class TenantUtils {
  /**
   * Builds the corresponding server request for a TenantOptions object.
   *
   * @param {TenantOptions} tenantOptions The properties to convert to a server request.
   * @param {boolean} createRequest Whether this is a create request.
   * @return {object} The equivalent server request.
   */
  public static buildServerRequest(
    tenantOptions: TenantOptions, createRequest: boolean): TenantOptionsServerRequest {
    TenantUtils.validate(tenantOptions, createRequest);
    let request: TenantOptionsServerRequest = {};
    if (typeof tenantOptions.emailSignInConfig !== 'undefined') {
      request = EmailSignInConfig.buildServerRequest(tenantOptions.emailSignInConfig);
    }
    if (typeof tenantOptions.displayName !== 'undefined') {
      request.displayName = tenantOptions.displayName;
    }
    if (typeof tenantOptions.multiFactorConfig !== 'undefined') {
      request.mfaConfig = MultiFactorAuthConfig.buildServerRequest(tenantOptions.multiFactorConfig);
    }
    if (typeof tenantOptions.testPhoneNumbers !== 'undefined') {
      // null will clear existing test phone numbers. Translate to empty object.
      request.testPhoneNumbers = tenantOptions.testPhoneNumbers ?? {};
    }
    return request;
  }

  /**
   * Returns the tenant ID corresponding to the resource name if available.
   *
   * @param {string} resourceName The server side resource name
   * @return {?string} The tenant ID corresponding to the resource, null otherwise.
   */
  public static getTenantIdFromResourceName(resourceName: string): string | null {
    // name is of form projects/project1/tenants/tenant1
    const matchTenantRes = resourceName.match(/\/tenants\/(.*)$/);
    if (!matchTenantRes || matchTenantRes.length < 2) {
      return null;
    }
    return matchTenantRes[1];
  }

  /**
   * Validates a tenant options object. Throws an error on failure.
   *
   * @param {any} request The tenant options object to validate.
   * @param {boolean} createRequest Whether this is a create request.
   */
  private static validate(request: any, createRequest: boolean): void {
    const validKeys = {
      displayName: true,
      emailSignInConfig: true,
      multiFactorConfig: true,
      testPhoneNumbers: true,
    };
    const label = createRequest ? 'CreateTenantRequest' : 'UpdateTenantRequest';
    if (!validator.isNonNullObject(request)) {
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_ARGUMENT,
        `"${label}" must be a valid non-null object.`,
      );
    }
    // Check for unsupported top level attributes.
    for (const key in request) {
      if (!(key in validKeys)) {
        throw new FirebaseAuthError(
          AuthClientErrorCode.INVALID_ARGUMENT,
          `"${key}" is not a valid ${label} parameter.`,
        );
      }
    }
    // Validate displayName type if provided.
    if (typeof request.displayName !== 'undefined' &&
        !validator.isNonEmptyString(request.displayName)) {
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_ARGUMENT,
        `"${label}.displayName" must be a valid non-empty string.`,
      );
    }
    // Validate emailSignInConfig type if provided.
    if (typeof request.emailSignInConfig !== 'undefined') {
      // This will throw an error if invalid.
      EmailSignInConfig.buildServerRequest(request.emailSignInConfig);
    }
    // Validate test phone numbers if provided.
    if (typeof request.testPhoneNumbers !== 'undefined' &&
        request.testPhoneNumbers !== null) {
      validateTestPhoneNumbers(request.testPhoneNumbers);
    } else if (request.testPhoneNumbers === null && createRequest) {
      // null allowed only for update operations.
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_ARGUMENT,
        `"${label}.testPhoneNumbers" must be a non-null object.`,
      );
    }
    // Validate multiFactorConfig type if provided.
    if (typeof request.multiFactorConfig !== 'undefined') {
      // This will throw an error if invalid.
      MultiFactorAuthConfig.buildServerRequest(request.multiFactorConfig);
    }
  }
}

/** A maximum of 10 test phone number / code pairs can be configured. */
export const MAXIMUM_TEST_PHONE_NUMBERS = 10;

/**
 * Validates the provided map of test phone number / code pairs.
 * @param testPhoneNumbers The phone number / code pairs to validate.
 */
export function validateTestPhoneNumbers(
  testPhoneNumbers: { [phoneNumber: string]: string },
): void {
  if (!validator.isObject(testPhoneNumbers)) {
    throw new FirebaseAuthError(
      AuthClientErrorCode.INVALID_ARGUMENT,
      '"testPhoneNumbers" must be a map of phone number / code pairs.',
    );
  }
  if (Object.keys(testPhoneNumbers).length > MAXIMUM_TEST_PHONE_NUMBERS) {
    throw new FirebaseAuthError(AuthClientErrorCode.MAXIMUM_TEST_PHONE_NUMBER_EXCEEDED);
  }
  for (const phoneNumber in testPhoneNumbers) {
    // Validate phone number.
    if (!validator.isPhoneNumber(phoneNumber)) {
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_TESTING_PHONE_NUMBER,
        `"${phoneNumber}" is not a valid E.164 standard compliant phone number.`
      );
    }

    // Validate code.
    if (!validator.isString(testPhoneNumbers[phoneNumber]) ||
      !/^[\d]{6}$/.test(testPhoneNumbers[phoneNumber])) {
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_TESTING_PHONE_NUMBER,
        `"${testPhoneNumbers[phoneNumber]}" is not a valid 6 digit code string.`
      );
    }
  }
}
