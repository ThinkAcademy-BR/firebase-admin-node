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

import { UserRecord, CreateRequest, UpdateRequest } from './user-record';
import { UserIdentifier } from './identifier';
import {
  isUidIdentifier, isEmailIdentifier, isPhoneIdentifier, isProviderIdentifier,
} from './identifier-internal';
import { FirebaseApp } from '../firebase-app';
import { FirebaseTokenGenerator, cryptoSignerFromApp } from './token-generator-internal';
import {
  AbstractAuthRequestHandler, AuthRequestHandler, TenantAwareAuthRequestHandler,
} from './auth-api-request';
import { AuthClientErrorCode, FirebaseAuthError, ErrorInfo } from '../utils/error';
import { FirebaseServiceInterface, FirebaseServiceInternalsInterface } from '../firebase-service';
import {
  UserImportOptions, UserImportRecord, UserImportResult,
} from './user-import-builder';

import * as utils from '../utils/index';
import * as validator from '../utils/validator';
import { 
  FirebaseTokenVerifier, createSessionCookieVerifier, createIdTokenVerifier 
} from './token-verifier-internal';
import { ActionCodeSettings } from './action-code-settings-builder-internal';
import {
  AuthProviderConfig, AuthProviderConfigFilter, ListProviderConfigResults, UpdateAuthProviderRequest,
} from './auth-config';
import {
  SAMLConfig, OIDCConfig, OIDCConfigServerResponse, SAMLConfigServerResponse
} from './auth-config-internal';
import { TenantManager } from './tenant-manager';
import { 
  DecodedIdToken, DeleteUsersResult, GetUsersResult,
  ListUsersResult, SessionCookieOptions
} from './auth';


export interface BaseAuth {
  /**
   * Creates a new Firebase custom token (JWT) that can be sent back to a client
   * device to use to sign in with the client SDKs' `signInWithCustomToken()`
   * methods. (Tenant-aware instances will also embed the tenant ID in the
   * token.)
   *
   * See [Create Custom Tokens](/docs/auth/admin/create-custom-tokens) for code
   * samples and detailed documentation.
   *
   * @param uid The `uid` to use as the custom token's subject.
   * @param developerClaims Optional additional claims to include
   *   in the custom token's payload.
   *
   * @return A promise fulfilled with a custom token for the
   *   provided `uid` and payload.
   */
  createCustomToken(uid: string, developerClaims?: object): Promise<string>;

  /**
   * Creates a new user.
   *
   * See [Create a user](/docs/auth/admin/manage-users#create_a_user) for code
   * samples and detailed documentation.
   *
   * @param properties The properties to set on the
   *   new user record to be created.
   *
   * @return A promise fulfilled with the user
   *   data corresponding to the newly created user.
   */
  createUser(properties: CreateRequest): Promise<UserRecord>;

  /**
   * Deletes an existing user.
   *
   * See [Delete a user](/docs/auth/admin/manage-users#delete_a_user) for code
   * samples and detailed documentation.
   *
   * @param uid The `uid` corresponding to the user to delete.
   *
   * @return An empty promise fulfilled once the user has been
   *   deleted.
   */
  deleteUser(uid: string): Promise<void>;

  /**
   * Deletes the users specified by the given uids.
   *
   * Deleting a non-existing user won't generate an error (i.e. this method
   * is idempotent.) Non-existing users are considered to be successfully
   * deleted, and are therefore counted in the
   * `DeleteUsersResult.successCount` value.
   *
   * Only a maximum of 1000 identifiers may be supplied. If more than 1000
   * identifiers are supplied, this method throws a FirebaseAuthError.
   *
   * This API is currently rate limited at the server to 1 QPS. If you exceed
   * this, you may get a quota exceeded error. Therefore, if you want to
   * delete more than 1000 users, you may need to add a delay to ensure you
   * don't go over this limit.
   *
   * @param uids The `uids` corresponding to the users to delete.
   *
   * @return A Promise that resolves to the total number of successful/failed
   *     deletions, as well as the array of errors that corresponds to the
   *     failed deletions.
   */
  deleteUsers(uids: string[]): Promise<DeleteUsersResult>;

  /**
   * Gets the user data for the user corresponding to a given `uid`.
   *
   * See [Retrieve user data](/docs/auth/admin/manage-users#retrieve_user_data)
   * for code samples and detailed documentation.
   *
   * @param uid The `uid` corresponding to the user whose data to fetch.
   *
   * @return A promise fulfilled with the user
   *   data corresponding to the provided `uid`.
   */
  getUser(uid: string): Promise<UserRecord>;

  /**
   * Gets the user data for the user corresponding to a given email.
   *
   * See [Retrieve user data](/docs/auth/admin/manage-users#retrieve_user_data)
   * for code samples and detailed documentation.
   *
   * @param email The email corresponding to the user whose data to
   *   fetch.
   *
   * @return A promise fulfilled with the user
   *   data corresponding to the provided email.
   */
  getUserByEmail(email: string): Promise<UserRecord>;

  /**
   * Gets the user data for the user corresponding to a given phone number. The
   * phone number has to conform to the E.164 specification.
   *
   * See [Retrieve user data](/docs/auth/admin/manage-users#retrieve_user_data)
   * for code samples and detailed documentation.
   *
   * @param phoneNumber The phone number corresponding to the user whose
   *   data to fetch.
   *
   * @return A promise fulfilled with the user
   *   data corresponding to the provided phone number.
   */
  getUserByPhoneNumber(phoneNumber: string): Promise<UserRecord>;

  /**
   * Gets the user data corresponding to the specified identifiers.
   *
   * There are no ordering guarantees; in particular, the nth entry in the result list is not
   * guaranteed to correspond to the nth entry in the input parameters list.
   *
   * Only a maximum of 100 identifiers may be supplied. If more than 100 identifiers are supplied,
   * this method throws a FirebaseAuthError.
   *
   * @param identifiers The identifiers used to indicate which user records should be returned.
   *     Must have <= 100 entries.
   * @return {Promise<GetUsersResult>} A promise that resolves to the corresponding user records.
   * @throws FirebaseAuthError If any of the identifiers are invalid or if more than 100
   *     identifiers are specified.
   */
  getUsers(identifiers: UserIdentifier[]): Promise<GetUsersResult>;

  /**
   * Retrieves a list of users (single batch only) with a size of `maxResults`
   * starting from the offset as specified by `pageToken`. This is used to
   * retrieve all the users of a specified project in batches.
   *
   * See [List all users](/docs/auth/admin/manage-users#list_all_users)
   * for code samples and detailed documentation.
   *
   * @param maxResults The page size, 1000 if undefined. This is also
   *   the maximum allowed limit.
   * @param pageToken The next page token. If not specified, returns
   *   users starting without any offset.
   * @return A promise that resolves with
   *   the current batch of downloaded users and the next page token.
   */
  listUsers(maxResults?: number, pageToken?: string): Promise<ListUsersResult>;

  /**
   * Updates an existing user.
   *
   * See [Update a user](/docs/auth/admin/manage-users#update_a_user) for code
   * samples and detailed documentation.
   *
   * @param uid The `uid` corresponding to the user to update.
   * @param properties The properties to update on
   *   the provided user.
   *
   * @return A promise fulfilled with the
   *   updated user data.
   */
  updateUser(uid: string, properties: UpdateRequest): Promise<UserRecord>;

  /**
   * Verifies a Firebase ID token (JWT). If the token is valid, the promise is
   * fulfilled with the token's decoded claims; otherwise, the promise is
   * rejected.
   * An optional flag can be passed to additionally check whether the ID token
   * was revoked.
   *
   * See [Verify ID Tokens](/docs/auth/admin/verify-id-tokens) for code samples
   * and detailed documentation.
   *
   * @param idToken The ID token to verify.
   * @param checkRevoked Whether to check if the ID token was revoked.
   *   This requires an extra request to the Firebase Auth backend to check
   *   the `tokensValidAfterTime` time for the corresponding user.
   *   When not specified, this additional check is not applied.
   *
   * @return A promise fulfilled with the
   *   token's decoded claims if the ID token is valid; otherwise, a rejected
   *   promise.
   */
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<DecodedIdToken>;

  /**
   * Sets additional developer claims on an existing user identified by the
   * provided `uid`, typically used to define user roles and levels of
   * access. These claims should propagate to all devices where the user is
   * already signed in (after token expiration or when token refresh is forced)
   * and the next time the user signs in. If a reserved OIDC claim name
   * is used (sub, iat, iss, etc), an error is thrown. They are set on the
   * authenticated user's ID token JWT.
   *
   * See
   * [Defining user roles and access levels](/docs/auth/admin/custom-claims)
   * for code samples and detailed documentation.
   *
   * @param uid The `uid` of the user to edit.
   * @param customUserClaims The developer claims to set. If null is
   *   passed, existing custom claims are deleted. Passing a custom claims payload
   *   larger than 1000 bytes will throw an error. Custom claims are added to the
   *   user's ID token which is transmitted on every authenticated request.
   *   For profile non-access related user attributes, use database or other
   *   separate storage systems.
   * @return A promise that resolves when the operation completes
   *   successfully.
   */
  setCustomUserClaims(uid: string, customUserClaims: object | null): Promise<void>;

  /**
   * Revokes all refresh tokens for an existing user.
   *
   * This API will update the user's
   * {@link admin.auth.UserRecord#tokensValidAfterTime `tokensValidAfterTime`} to
   * the current UTC. It is important that the server on which this is called has
   * its clock set correctly and synchronized.
   *
   * While this will revoke all sessions for a specified user and disable any
   * new ID tokens for existing sessions from getting minted, existing ID tokens
   * may remain active until their natural expiration (one hour). To verify that
   * ID tokens are revoked, use
   * {@link admin.auth.Auth#verifyIdToken `verifyIdToken(idToken, true)`}
   * where `checkRevoked` is set to true.
   *
   * @param uid The `uid` corresponding to the user whose refresh tokens
   *   are to be revoked.
   *
   * @return An empty promise fulfilled once the user's refresh
   *   tokens have been revoked.
   */
  revokeRefreshTokens(uid: string): Promise<void>;

  /**
   * Imports the provided list of users into Firebase Auth.
   * A maximum of 1000 users are allowed to be imported one at a time.
   * When importing users with passwords,
   * {@link admin.auth.UserImportOptions `UserImportOptions`} are required to be
   * specified.
   * This operation is optimized for bulk imports and will ignore checks on `uid`,
   * `email` and other identifier uniqueness which could result in duplications.
   *
   * @param users The list of user records to import to Firebase Auth.
   * @param options The user import options, required when the users provided include
   *   password credentials.
   * @return A promise that resolves when
   *   the operation completes with the result of the import. This includes the
   *   number of successful imports, the number of failed imports and their
   *   corresponding errors.
  */
  importUsers(
    users: UserImportRecord[],
    options?: UserImportOptions,
  ): Promise<UserImportResult>;

  /**
   * Creates a new Firebase session cookie with the specified options. The created
   * JWT string can be set as a server-side session cookie with a custom cookie
   * policy, and be used for session management. The session cookie JWT will have
   * the same payload claims as the provided ID token.
   *
   * See [Manage Session Cookies](/docs/auth/admin/manage-cookies) for code
   * samples and detailed documentation.
   *
   * @param idToken The Firebase ID token to exchange for a session
   *   cookie.
   * @param sessionCookieOptions The session
   *   cookie options which includes custom session duration.
   *
   * @return A promise that resolves on success with the
   *   created session cookie.
   */
  createSessionCookie(
    idToken: string,
    sessionCookieOptions: SessionCookieOptions,
  ): Promise<string>;

  /**
   * Verifies a Firebase session cookie. Returns a Promise with the cookie claims.
   * Rejects the promise if the cookie could not be verified. If `checkRevoked` is
   * set to true, verifies if the session corresponding to the session cookie was
   * revoked. If the corresponding user's session was revoked, an
   * `auth/session-cookie-revoked` error is thrown. If not specified the check is
   * not performed.
   *
   * See [Verify Session Cookies](/docs/auth/admin/manage-cookies#verify_session_cookie_and_check_permissions)
   * for code samples and detailed documentation
   *
   * @param sessionCookie The session cookie to verify.
   * @param checkForRevocation  Whether to check if the session cookie was
   *   revoked. This requires an extra request to the Firebase Auth backend to
   *   check the `tokensValidAfterTime` time for the corresponding user.
   *   When not specified, this additional check is not performed.
   *
   * @return A promise fulfilled with the
   *   session cookie's decoded claims if the session cookie is valid; otherwise,
   *   a rejected promise.
   */
  verifySessionCookie(
    sessionCookie: string,
    checkForRevocation?: boolean,
  ): Promise<DecodedIdToken>;

  /**
   * Generates the out of band email action link to reset a user's password.
   * The link is generated for the user with the specified email address. The
   * optional  {@link admin.auth.ActionCodeSettings `ActionCodeSettings`} object
   * defines whether the link is to be handled by a mobile app or browser and the
   * additional state information to be passed in the deep link, etc.
   *
   * @example
   * ```javascript
   * var actionCodeSettings = {
   *   url: 'https://www.example.com/?email=user@example.com',
   *   iOS: {
   *     bundleId: 'com.example.ios'
   *   },
   *   android: {
   *     packageName: 'com.example.android',
   *     installApp: true,
   *     minimumVersion: '12'
   *   },
   *   handleCodeInApp: true,
   *   dynamicLinkDomain: 'custom.page.link'
   * };
   * admin.auth()
   *     .generatePasswordResetLink('user@example.com', actionCodeSettings)
   *     .then(function(link) {
   *       // The link was successfully generated.
   *     })
   *     .catch(function(error) {
   *       // Some error occurred, you can inspect the code: error.code
   *     });
   * ```
   *
   * @param email The email address of the user whose password is to be
   *   reset.
   * @param actionCodeSettings The action
   *     code settings. If specified, the state/continue URL is set as the
   *     "continueUrl" parameter in the password reset link. The default password
   *     reset landing page will use this to display a link to go back to the app
   *     if it is installed.
   *     If the actionCodeSettings is not specified, no URL is appended to the
   *     action URL.
   *     The state URL provided must belong to a domain that is whitelisted by the
   *     developer in the console. Otherwise an error is thrown.
   *     Mobile app redirects are only applicable if the developer configures
   *     and accepts the Firebase Dynamic Links terms of service.
   *     The Android package name and iOS bundle ID are respected only if they
   *     are configured in the same Firebase Auth project.
   * @return A promise that resolves with the generated link.
   */
  generatePasswordResetLink(
    email: string,
    actionCodeSettings?: ActionCodeSettings,
  ): Promise<string>;

  /**
   * Generates the out of band email action link to verify the user's ownership
   * of the specified email. The
   * {@link admin.auth.ActionCodeSettings `ActionCodeSettings`} object provided
   * as an argument to this method defines whether the link is to be handled by a
   * mobile app or browser along with additional state information to be passed in
   * the deep link, etc.
   *
   * @example
   * ```javascript
   * var actionCodeSettings = {
    *   url: 'https://www.example.com/cart?email=user@example.com&cartId=123',
    *   iOS: {
    *     bundleId: 'com.example.ios'
    *   },
    *   android: {
    *     packageName: 'com.example.android',
    *     installApp: true,
    *     minimumVersion: '12'
    *   },
    *   handleCodeInApp: true,
    *   dynamicLinkDomain: 'custom.page.link'
    * };
    * admin.auth()
    *     .generateEmailVerificationLink('user@example.com', actionCodeSettings)
    *     .then(function(link) {
    *       // The link was successfully generated.
    *     })
    *     .catch(function(error) {
    *       // Some error occurred, you can inspect the code: error.code
    *     });
    * ```
    *
    * @param email The email account to verify.
    * @param actionCodeSettings The action
    *     code settings. If specified, the state/continue URL is set as the
    *     "continueUrl" parameter in the email verification link. The default email
    *     verification landing page will use this to display a link to go back to
    *     the app if it is installed.
    *     If the actionCodeSettings is not specified, no URL is appended to the
    *     action URL.
    *     The state URL provided must belong to a domain that is whitelisted by the
    *     developer in the console. Otherwise an error is thrown.
    *     Mobile app redirects are only applicable if the developer configures
    *     and accepts the Firebase Dynamic Links terms of service.
    *     The Android package name and iOS bundle ID are respected only if they
    *     are configured in the same Firebase Auth project.
    * @return A promise that resolves with the generated link.
   */
  generateEmailVerificationLink(
    email: string,
    actionCodeSettings?: ActionCodeSettings,
  ): Promise<string>;

  /**
   * Generates the out of band email action link to sign in or sign up the owner
   * of the specified email. The
   * {@link admin.auth.ActionCodeSettings `ActionCodeSettings`} object provided
   * as an argument to this method defines whether the link is to be handled by a
   * mobile app or browser along with additional state information to be passed in
   * the deep link, etc.
   *
   * @example
   * ```javascript
   * var actionCodeSettings = {
    *   // The URL to redirect to for sign-in completion. This is also the deep
    *   // link for mobile redirects. The domain (www.example.com) for this URL
    *   // must be whitelisted in the Firebase Console.
    *   url: 'https://www.example.com/finishSignUp?cartId=1234',
    *   iOS: {
    *     bundleId: 'com.example.ios'
    *   },
    *   android: {
    *     packageName: 'com.example.android',
    *     installApp: true,
    *     minimumVersion: '12'
    *   },
    *   // This must be true.
    *   handleCodeInApp: true,
    *   dynamicLinkDomain: 'custom.page.link'
    * };
    * admin.auth()
    *     .generateSignInWithEmailLink('user@example.com', actionCodeSettings)
    *     .then(function(link) {
    *       // The link was successfully generated.
    *     })
    *     .catch(function(error) {
    *       // Some error occurred, you can inspect the code: error.code
    *     });
    * ```
    *
    * @param email The email account to sign in with.
    * @param actionCodeSettings The action
    *     code settings. These settings provide Firebase with instructions on how
    *     to construct the email link. This includes the sign in completion URL or
    *     the deep link for redirects and the mobile apps to use when the
    *     sign-in link is opened on an Android or iOS device.
    *     Mobile app redirects are only applicable if the developer configures
    *     and accepts the Firebase Dynamic Links terms of service.
    *     The Android package name and iOS bundle ID are respected only if they
    *     are configured in the same Firebase Auth project.
    * @return A promise that resolves with the generated link.
   */
  generateSignInWithEmailLink(
    email: string,
    actionCodeSettings: ActionCodeSettings,
  ): Promise<string>;

  /**
   * Returns the list of existing provider configurations matching the filter
   * provided. At most, 100 provider configs can be listed at a time.
   *
   * SAML and OIDC provider support requires Google Cloud's Identity Platform
   * (GCIP). To learn more about GCIP, including pricing and features,
   * see the [GCIP documentation](https://cloud.google.com/identity-platform).
   *
   * @param options The provider config filter to apply.
   * @return A promise that resolves with the list of provider configs meeting the
   *   filter requirements.
   */
  listProviderConfigs(
    options: AuthProviderConfigFilter
  ): Promise<ListProviderConfigResults>;

  /**
   * Looks up an Auth provider configuration by the provided ID.
   * Returns a promise that resolves with the provider configuration
   * corresponding to the provider ID specified. If the specified ID does not
   * exist, an `auth/configuration-not-found` error is thrown.
   *
   * SAML and OIDC provider support requires Google Cloud's Identity Platform
   * (GCIP). To learn more about GCIP, including pricing and features,
   * see the [GCIP documentation](https://cloud.google.com/identity-platform).
   *
   * @param providerId The provider ID corresponding to the provider
   *     config to return.
   * @return A promise that resolves
   *     with the configuration corresponding to the provided ID.
   */
  getProviderConfig(providerId: string): Promise<AuthProviderConfig>;

  /**
   * Deletes the provider configuration corresponding to the provider ID passed.
   * If the specified ID does not exist, an `auth/configuration-not-found` error
   * is thrown.
   *
   * SAML and OIDC provider support requires Google Cloud's Identity Platform
   * (GCIP). To learn more about GCIP, including pricing and features,
   * see the [GCIP documentation](https://cloud.google.com/identity-platform).
   *
   * @param providerId The provider ID corresponding to the provider
   *     config to delete.
   * @return A promise that resolves on completion.
   */
  deleteProviderConfig(providerId: string): Promise<void>;

  /**
   * Returns a promise that resolves with the updated `AuthProviderConfig`
   * corresponding to the provider ID specified.
   * If the specified ID does not exist, an `auth/configuration-not-found` error
   * is thrown.
   *
   * SAML and OIDC provider support requires Google Cloud's Identity Platform
   * (GCIP). To learn more about GCIP, including pricing and features,
   * see the [GCIP documentation](https://cloud.google.com/identity-platform).
   *
   * @param providerId The provider ID corresponding to the provider
   *     config to update.
   * @param updatedConfig The updated configuration.
   * @return A promise that resolves with the updated provider configuration.
   */
  updateProviderConfig(
    providerId: string, updatedConfig: UpdateAuthProviderRequest
  ): Promise<AuthProviderConfig>;

  /**
   * Returns a promise that resolves with the newly created `AuthProviderConfig`
   * when the new provider configuration is created.
   *
   * SAML and OIDC provider support requires Google Cloud's Identity Platform
   * (GCIP). To learn more about GCIP, including pricing and features,
   * see the [GCIP documentation](https://cloud.google.com/identity-platform).
   *
   * @param config The provider configuration to create.
   * @return A promise that resolves with the created provider configuration.
   */
  createProviderConfig(
    config: AuthProviderConfig
  ): Promise<AuthProviderConfig>;
}


/**
 * Base Auth class. Mainly used for user management APIs.
 */
export class BaseAuthImpl<T extends AbstractAuthRequestHandler> implements BaseAuth{

  protected readonly tokenGenerator: FirebaseTokenGenerator;
  protected readonly idTokenVerifier: FirebaseTokenVerifier;
  protected readonly sessionCookieVerifier: FirebaseTokenVerifier;

  /**
   * The BaseAuth class constructor.
   *
   * @param app The FirebaseApp to associate with this Auth instance.
   * @param authRequestHandler The RPC request handler for this instance.
   * @param tokenGenerator Optional token generator. If not specified, a
   *     (non-tenant-aware) instance will be created. Use this paramter to
   *     specify a tenant-aware tokenGenerator.
   * @constructor
   */
  constructor(app: FirebaseApp, protected readonly authRequestHandler: T, tokenGenerator?: FirebaseTokenGenerator) {
    if (tokenGenerator) {
      this.tokenGenerator = tokenGenerator;
    } else {
      const cryptoSigner = cryptoSignerFromApp(app);
      this.tokenGenerator = new FirebaseTokenGenerator(cryptoSigner);
    }

    this.sessionCookieVerifier = createSessionCookieVerifier(app);
    this.idTokenVerifier = createIdTokenVerifier(app);
  }

  /**
   * Creates a new custom token that can be sent back to a client to use with
   * signInWithCustomToken().
   *
   * @param {string} uid The uid to use as the JWT subject.
   * @param {object=} developerClaims Optional additional claims to include in the JWT payload.
   *
   * @return {Promise<string>} A JWT for the provided payload.
   */
  public createCustomToken(uid: string, developerClaims?: object): Promise<string> {
    return this.tokenGenerator.createCustomToken(uid, developerClaims);
  }

  /**
   * Verifies a JWT auth token. Returns a Promise with the tokens claims. Rejects
   * the promise if the token could not be verified. If checkRevoked is set to true,
   * verifies if the session corresponding to the ID token was revoked. If the corresponding
   * user's session was invalidated, an auth/id-token-revoked error is thrown. If not specified
   * the check is not applied.
   *
   * @param {string} idToken The JWT to verify.
   * @param {boolean=} checkRevoked Whether to check if the ID token is revoked.
   * @return {Promise<DecodedIdToken>} A Promise that will be fulfilled after a successful
   *     verification.
   */
  public verifyIdToken(idToken: string, checkRevoked = false): Promise<DecodedIdToken> {
    return this.idTokenVerifier.verifyJWT(idToken)
      .then((decodedIdToken: DecodedIdToken) => {
        // Whether to check if the token was revoked.
        if (!checkRevoked) {
          return decodedIdToken;
        }
        return this.verifyDecodedJWTNotRevoked(
          decodedIdToken,
          AuthClientErrorCode.ID_TOKEN_REVOKED);
      });
  }

  /**
   * Looks up the user identified by the provided user id and returns a promise that is
   * fulfilled with a user record for the given user if that user is found.
   *
   * @param {string} uid The uid of the user to look up.
   * @return {Promise<UserRecord>} A promise that resolves with the corresponding user record.
   */
  public getUser(uid: string): Promise<UserRecord> {
    return this.authRequestHandler.getAccountInfoByUid(uid)
      .then((response: any) => {
        // Returns the user record populated with server response.
        return new UserRecord(response.users[0]);
      });
  }

  /**
   * Looks up the user identified by the provided email and returns a promise that is
   * fulfilled with a user record for the given user if that user is found.
   *
   * @param {string} email The email of the user to look up.
   * @return {Promise<UserRecord>} A promise that resolves with the corresponding user record.
   */
  public getUserByEmail(email: string): Promise<UserRecord> {
    return this.authRequestHandler.getAccountInfoByEmail(email)
      .then((response: any) => {
        // Returns the user record populated with server response.
        return new UserRecord(response.users[0]);
      });
  }

  /**
   * Looks up the user identified by the provided phone number and returns a promise that is
   * fulfilled with a user record for the given user if that user is found.
   *
   * @param {string} phoneNumber The phone number of the user to look up.
   * @return {Promise<UserRecord>} A promise that resolves with the corresponding user record.
   */
  public getUserByPhoneNumber(phoneNumber: string): Promise<UserRecord> {
    return this.authRequestHandler.getAccountInfoByPhoneNumber(phoneNumber)
      .then((response: any) => {
        // Returns the user record populated with server response.
        return new UserRecord(response.users[0]);
      });
  }

  /**
   * Gets the user data corresponding to the specified identifiers.
   *
   * There are no ordering guarantees; in particular, the nth entry in the result list is not
   * guaranteed to correspond to the nth entry in the input parameters list.
   *
   * Only a maximum of 100 identifiers may be supplied. If more than 100 identifiers are supplied,
   * this method will immediately throw a FirebaseAuthError.
   *
   * @param identifiers The identifiers used to indicate which user records should be returned. Must
   *     have <= 100 entries.
   * @return {Promise<GetUsersResult>} A promise that resolves to the corresponding user records.
   * @throws FirebaseAuthError If any of the identifiers are invalid or if more than 100
   *     identifiers are specified.
   */
  public getUsers(identifiers: UserIdentifier[]): Promise<GetUsersResult> {
    if (!validator.isArray(identifiers)) {
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_ARGUMENT, '`identifiers` parameter must be an array');
    }
    return this.authRequestHandler
      .getAccountInfoByIdentifiers(identifiers)
      .then((response: any) => {
        /**
         * Checks if the specified identifier is within the list of
         * UserRecords.
         */
        const isUserFound = ((id: UserIdentifier, userRecords: UserRecord[]): boolean => {
          return !!userRecords.find((userRecord) => {
            if (isUidIdentifier(id)) {
              return id.uid === userRecord.uid;
            } else if (isEmailIdentifier(id)) {
              return id.email === userRecord.email;
            } else if (isPhoneIdentifier(id)) {
              return id.phoneNumber === userRecord.phoneNumber;
            } else if (isProviderIdentifier(id)) {
              const matchingUserInfo = userRecord.providerData.find((userInfo) => {
                return id.providerId === userInfo.providerId;
              });
              return !!matchingUserInfo && id.providerUid === matchingUserInfo.uid;
            } else {
              throw new FirebaseAuthError(
                AuthClientErrorCode.INTERNAL_ERROR,
                'Unhandled identifier type');
            }
          });
        });

        const users = response.users ? response.users.map((user: any) => new UserRecord(user)) : [];
        const notFound = identifiers.filter((id) => !isUserFound(id, users));

        return { users, notFound };
      });
  }

  /**
   * Exports a batch of user accounts. Batch size is determined by the maxResults argument.
   * Starting point of the batch is determined by the pageToken argument.
   *
   * @param {number=} maxResults The page size, 1000 if undefined. This is also the maximum
   *     allowed limit.
   * @param {string=} pageToken The next page token. If not specified, returns users starting
   *     without any offset.
   * @return {Promise<{users: UserRecord[], pageToken?: string}>} A promise that resolves with
   *     the current batch of downloaded users and the next page token. For the last page, an
   *     empty list of users and no page token are returned.
   */
  public listUsers(maxResults?: number, pageToken?: string): Promise<ListUsersResult> {
    return this.authRequestHandler.downloadAccount(maxResults, pageToken)
      .then((response: any) => {
        // List of users to return.
        const users: UserRecord[] = [];
        // Convert each user response to a UserRecord.
        response.users.forEach((userResponse: any) => {
          users.push(new UserRecord(userResponse));
        });
        // Return list of user records and the next page token if available.
        const result = {
          users,
          pageToken: response.nextPageToken,
        };
        // Delete result.pageToken if undefined.
        if (typeof result.pageToken === 'undefined') {
          delete result.pageToken;
        }
        return result;
      });
  }

  /**
   * Creates a new user with the properties provided.
   *
   * @param {CreateRequest} properties The properties to set on the new user record to be created.
   * @return {Promise<UserRecord>} A promise that resolves with the newly created user record.
   */
  public createUser(properties: CreateRequest): Promise<UserRecord> {
    return this.authRequestHandler.createNewAccount(properties)
      .then((uid) => {
        // Return the corresponding user record.
        return this.getUser(uid);
      })
      .catch((error) => {
        if (error.code === 'auth/user-not-found') {
          // Something must have happened after creating the user and then retrieving it.
          throw new FirebaseAuthError(
            AuthClientErrorCode.INTERNAL_ERROR,
            'Unable to create the user record provided.');
        }
        throw error;
      });
  }

  /**
   * Deletes the user identified by the provided user id and returns a promise that is
   * fulfilled when the user is found and successfully deleted.
   *
   * @param {string} uid The uid of the user to delete.
   * @return {Promise<void>} A promise that resolves when the user is successfully deleted.
   */
  public deleteUser(uid: string): Promise<void> {
    return this.authRequestHandler.deleteAccount(uid)
      .then(() => {
        // Return nothing on success.
      });
  }

  public deleteUsers(uids: string[]): Promise<DeleteUsersResult> {
    if (!validator.isArray(uids)) {
      throw new FirebaseAuthError(
        AuthClientErrorCode.INVALID_ARGUMENT, '`uids` parameter must be an array');
    }
    return this.authRequestHandler.deleteAccounts(uids, /*force=*/true)
      .then((batchDeleteAccountsResponse) => {
        const result: DeleteUsersResult = {
          failureCount: 0,
          successCount: uids.length,
          errors: [],
        };

        if (!validator.isNonEmptyArray(batchDeleteAccountsResponse.errors)) {
          return result;
        }

        result.failureCount = batchDeleteAccountsResponse.errors.length;
        result.successCount = uids.length - batchDeleteAccountsResponse.errors.length;
        result.errors = batchDeleteAccountsResponse.errors.map((batchDeleteErrorInfo) => {
          if (batchDeleteErrorInfo.index === undefined) {
            throw new FirebaseAuthError(
              AuthClientErrorCode.INTERNAL_ERROR,
              'Corrupt BatchDeleteAccountsResponse detected');
          }

          const errMsgToError = (msg?: string): FirebaseAuthError => {
            // We unconditionally set force=true, so the 'NOT_DISABLED' error
            // should not be possible.
            const code = msg && msg.startsWith('NOT_DISABLED') ?
              AuthClientErrorCode.USER_NOT_DISABLED : AuthClientErrorCode.INTERNAL_ERROR;
            return new FirebaseAuthError(code, batchDeleteErrorInfo.message);
          };

          return {
            index: batchDeleteErrorInfo.index,
            error: errMsgToError(batchDeleteErrorInfo.message),
          };
        });

        return result;
      });
  }

  /**
   * Updates an existing user with the properties provided.
   *
   * @param {string} uid The uid identifier of the user to update.
   * @param {UpdateRequest} properties The properties to update on the existing user.
   * @return {Promise<UserRecord>} A promise that resolves with the modified user record.
   */
  public updateUser(uid: string, properties: UpdateRequest): Promise<UserRecord> {
    return this.authRequestHandler.updateExistingAccount(uid, properties)
      .then((existingUid) => {
        // Return the corresponding user record.
        return this.getUser(existingUid);
      });
  }

  /**
   * Sets additional developer claims on an existing user identified by the provided UID.
   *
   * @param {string} uid The user to edit.
   * @param {object} customUserClaims The developer claims to set.
   * @return {Promise<void>} A promise that resolves when the operation completes
   *     successfully.
   */
  public setCustomUserClaims(uid: string, customUserClaims: object | null): Promise<void> {
    return this.authRequestHandler.setCustomUserClaims(uid, customUserClaims)
      .then(() => {
        // Return nothing on success.
      });
  }

  /**
   * Revokes all refresh tokens for the specified user identified by the provided UID.
   * In addition to revoking all refresh tokens for a user, all ID tokens issued before
   * revocation will also be revoked on the Auth backend. Any request with an ID token
   * generated before revocation will be rejected with a token expired error.
   *
   * @param {string} uid The user whose tokens are to be revoked.
   * @return {Promise<void>} A promise that resolves when the operation completes
   *     successfully.
   */
  public revokeRefreshTokens(uid: string): Promise<void> {
    return this.authRequestHandler.revokeRefreshTokens(uid)
      .then(() => {
        // Return nothing on success.
      });
  }

  /**
   * Imports the list of users provided to Firebase Auth. This is useful when
   * migrating from an external authentication system without having to use the Firebase CLI SDK.
   * At most, 1000 users are allowed to be imported one at a time.
   * When importing a list of password users, UserImportOptions are required to be specified.
   *
   * @param {UserImportRecord[]} users The list of user records to import to Firebase Auth.
   * @param {UserImportOptions=} options The user import options, required when the users provided
   *     include password credentials.
   * @return {Promise<UserImportResult>} A promise that resolves when the operation completes
   *     with the result of the import. This includes the number of successful imports, the number
   *     of failed uploads and their corresponding errors.
   */
  public importUsers(
    users: UserImportRecord[], options?: UserImportOptions): Promise<UserImportResult> {
    return this.authRequestHandler.uploadAccount(users, options);
  }

  /**
   * Creates a new Firebase session cookie with the specified options that can be used for
   * session management (set as a server side session cookie with custom cookie policy).
   * The session cookie JWT will have the same payload claims as the provided ID token.
   *
   * @param {string} idToken The Firebase ID token to exchange for a session cookie.
   * @param {SessionCookieOptions} sessionCookieOptions The session cookie options which includes
   *     custom session duration.
   *
   * @return {Promise<string>} A promise that resolves on success with the created session cookie.
   */
  public createSessionCookie(
    idToken: string, sessionCookieOptions: SessionCookieOptions): Promise<string> {
    // Return rejected promise if expiresIn is not available.
    if (!validator.isNonNullObject(sessionCookieOptions) ||
        !validator.isNumber(sessionCookieOptions.expiresIn)) {
      return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_SESSION_COOKIE_DURATION));
    }
    return this.authRequestHandler.createSessionCookie(
      idToken, sessionCookieOptions.expiresIn);
  }

  /**
   * Verifies a Firebase session cookie. Returns a Promise with the tokens claims. Rejects
   * the promise if the token could not be verified. If checkRevoked is set to true,
   * verifies if the session corresponding to the session cookie was revoked. If the corresponding
   * user's session was invalidated, an auth/session-cookie-revoked error is thrown. If not
   * specified the check is not performed.
   *
   * @param {string} sessionCookie The session cookie to verify.
   * @param {boolean=} checkRevoked Whether to check if the session cookie is revoked.
   * @return {Promise<DecodedIdToken>} A Promise that will be fulfilled after a successful
   *     verification.
   */
  public verifySessionCookie(
    sessionCookie: string, checkRevoked = false): Promise<DecodedIdToken> {
    return this.sessionCookieVerifier.verifyJWT(sessionCookie)
      .then((decodedIdToken: DecodedIdToken) => {
        // Whether to check if the token was revoked.
        if (!checkRevoked) {
          return decodedIdToken;
        }
        return this.verifyDecodedJWTNotRevoked(
          decodedIdToken,
          AuthClientErrorCode.SESSION_COOKIE_REVOKED);
      });
  }

  /**
   * Generates the out of band email action link for password reset flows for the
   * email specified using the action code settings provided.
   * Returns a promise that resolves with the generated link.
   *
   * @param {string} email The email of the user whose password is to be reset.
   * @param {ActionCodeSettings=} actionCodeSettings The optional action code setings which defines whether
   *     the link is to be handled by a mobile app and the additional state information to be passed in the
   *     deep link, etc.
   * @return {Promise<string>} A promise that resolves with the password reset link.
   */
  public generatePasswordResetLink(email: string, actionCodeSettings?: ActionCodeSettings): Promise<string> {
    return this.authRequestHandler.getEmailActionLink('PASSWORD_RESET', email, actionCodeSettings);
  }

  /**
   * Generates the out of band email action link for email verification flows for the
   * email specified using the action code settings provided.
   * Returns a promise that resolves with the generated link.
   *
   * @param {string} email The email of the user to be verified.
   * @param {ActionCodeSettings=} actionCodeSettings The optional action code setings which defines whether
   *     the link is to be handled by a mobile app and the additional state information to be passed in the
   *     deep link, etc.
   * @return {Promise<string>} A promise that resolves with the email verification link.
   */
  public generateEmailVerificationLink(email: string, actionCodeSettings?: ActionCodeSettings): Promise<string> {
    return this.authRequestHandler.getEmailActionLink('VERIFY_EMAIL', email, actionCodeSettings);
  }

  /**
   * Generates the out of band email action link for email link sign-in flows for the
   * email specified using the action code settings provided.
   * Returns a promise that resolves with the generated link.
   *
   * @param {string} email The email of the user signing in.
   * @param {ActionCodeSettings} actionCodeSettings The required action code setings which defines whether
   *     the link is to be handled by a mobile app and the additional state information to be passed in the
   *     deep link, etc.
   * @return {Promise<string>} A promise that resolves with the email sign-in link.
   */
  public generateSignInWithEmailLink(email: string, actionCodeSettings: ActionCodeSettings): Promise<string> {
    return this.authRequestHandler.getEmailActionLink('EMAIL_SIGNIN', email, actionCodeSettings);
  }

  /**
   * Returns the list of existing provider configuation matching the filter provided.
   * At most, 100 provider configs are allowed to be imported at a time.
   *
   * @param {AuthProviderConfigFilter} options The provider config filter to apply.
   * @return {Promise<ListProviderConfigResults>} A promise that resolves with the list of provider configs
   *     meeting the filter requirements.
   */
  public listProviderConfigs(options: AuthProviderConfigFilter): Promise<ListProviderConfigResults> {
    const processResponse = (response: any, providerConfigs: AuthProviderConfig[]): ListProviderConfigResults => {
      // Return list of provider configuration and the next page token if available.
      const result: ListProviderConfigResults = {
        providerConfigs,
      };
      // Delete result.pageToken if undefined.
      if (Object.prototype.hasOwnProperty.call(response, 'nextPageToken')) {
        result.pageToken = response.nextPageToken;
      }
      return result;
    };
    if (options && options.type === 'oidc') {
      return this.authRequestHandler.listOAuthIdpConfigs(options.maxResults, options.pageToken)
        .then((response: any) => {
          // List of provider configurations to return.
          const providerConfigs: OIDCConfig[] = [];
          // Convert each provider config response to a OIDCConfig.
          response.oauthIdpConfigs.forEach((configResponse: any) => {
            providerConfigs.push(new OIDCConfig(configResponse));
          });
          // Return list of provider configuration and the next page token if available.
          return processResponse(response, providerConfigs);
        });
    } else if (options && options.type === 'saml') {
      return this.authRequestHandler.listInboundSamlConfigs(options.maxResults, options.pageToken)
        .then((response: any) => {
          // List of provider configurations to return.
          const providerConfigs: SAMLConfig[] = [];
          // Convert each provider config response to a SAMLConfig.
          response.inboundSamlConfigs.forEach((configResponse: any) => {
            providerConfigs.push(new SAMLConfig(configResponse));
          });
          // Return list of provider configuration and the next page token if available.
          return processResponse(response, providerConfigs);
        });
    }
    return Promise.reject(
      new FirebaseAuthError(
        AuthClientErrorCode.INVALID_ARGUMENT,
        `"AuthProviderConfigFilter.type" must be either "saml' or "oidc"`));
  }

  /**
   * Looks up an Auth provider configuration by ID.
   * Returns a promise that resolves with the provider configuration corresponding to the provider ID specified.
   *
   * @param {string} providerId  The provider ID corresponding to the provider config to return.
   * @return {Promise<AuthProviderConfig>}
   */
  public getProviderConfig(providerId: string): Promise<AuthProviderConfig> {
    if (OIDCConfig.isProviderId(providerId)) {
      return this.authRequestHandler.getOAuthIdpConfig(providerId)
        .then((response: OIDCConfigServerResponse) => {
          return new OIDCConfig(response);
        });
    } else if (SAMLConfig.isProviderId(providerId)) {
      return this.authRequestHandler.getInboundSamlConfig(providerId)
        .then((response: SAMLConfigServerResponse) => {
          return new SAMLConfig(response);
        });
    }
    return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_PROVIDER_ID));
  }

  /**
   * Deletes the provider configuration corresponding to the provider ID passed.
   *
   * @param {string} providerId The provider ID corresponding to the provider config to delete.
   * @return {Promise<void>} A promise that resolves on completion.
   */
  public deleteProviderConfig(providerId: string): Promise<void> {
    if (OIDCConfig.isProviderId(providerId)) {
      return this.authRequestHandler.deleteOAuthIdpConfig(providerId);
    } else if (SAMLConfig.isProviderId(providerId)) {
      return this.authRequestHandler.deleteInboundSamlConfig(providerId);
    }
    return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_PROVIDER_ID));
  }

  /**
   * Returns a promise that resolves with the updated AuthProviderConfig when the provider configuration corresponding
   * to the provider ID specified is updated with the specified configuration.
   *
   * @param {string} providerId The provider ID corresponding to the provider config to update.
   * @param {UpdateAuthProviderRequest} updatedConfig The updated configuration.
   * @return {Promise<AuthProviderConfig>} A promise that resolves with the updated provider configuration.
   */
  public updateProviderConfig(
    providerId: string, updatedConfig: UpdateAuthProviderRequest): Promise<AuthProviderConfig> {
    if (!validator.isNonNullObject(updatedConfig)) {
      return Promise.reject(new FirebaseAuthError(
        AuthClientErrorCode.INVALID_CONFIG,
        'Request is missing "UpdateAuthProviderRequest" configuration.',
      ));
    }
    if (OIDCConfig.isProviderId(providerId)) {
      return this.authRequestHandler.updateOAuthIdpConfig(providerId, updatedConfig)
        .then((response) => {
          return new OIDCConfig(response);
        });
    } else if (SAMLConfig.isProviderId(providerId)) {
      return this.authRequestHandler.updateInboundSamlConfig(providerId, updatedConfig)
        .then((response) => {
          return new SAMLConfig(response);
        });
    }
    return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_PROVIDER_ID));
  }

  /**
   * Returns a promise that resolves with the newly created AuthProviderConfig when the new provider configuration is
   * created.
   * @param {AuthProviderConfig} config The provider configuration to create.
   * @return {Promise<AuthProviderConfig>} A promise that resolves with the created provider configuration.
   */
  public createProviderConfig(config: AuthProviderConfig): Promise<AuthProviderConfig> {
    if (!validator.isNonNullObject(config)) {
      return Promise.reject(new FirebaseAuthError(
        AuthClientErrorCode.INVALID_CONFIG,
        'Request is missing "AuthProviderConfig" configuration.',
      ));
    }
    if (OIDCConfig.isProviderId(config.providerId)) {
      return this.authRequestHandler.createOAuthIdpConfig(config)
        .then((response) => {
          return new OIDCConfig(response);
        });
    } else if (SAMLConfig.isProviderId(config.providerId)) {
      return this.authRequestHandler.createInboundSamlConfig(config)
        .then((response) => {
          return new SAMLConfig(response);
        });
    }
    return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_PROVIDER_ID));
  }

  /**
   * Verifies the decoded Firebase issued JWT is not revoked. Returns a promise that resolves
   * with the decoded claims on success. Rejects the promise with revocation error if revoked.
   *
   * @param {DecodedIdToken} decodedIdToken The JWT's decoded claims.
   * @param {ErrorInfo} revocationErrorInfo The revocation error info to throw on revocation
   *     detection.
   * @return {Promise<DecodedIdToken>} A Promise that will be fulfilled after a successful
   *     verification.
   */
  private verifyDecodedJWTNotRevoked(
    decodedIdToken: DecodedIdToken, revocationErrorInfo: ErrorInfo): Promise<DecodedIdToken> {
    // Get tokens valid after time for the corresponding user.
    return this.getUser(decodedIdToken.sub)
      .then((user: UserRecord) => {
        // If no tokens valid after time available, token is not revoked.
        if (user.tokensValidAfterTime) {
          // Get the ID token authentication time and convert to milliseconds UTC.
          const authTimeUtc = decodedIdToken.auth_time * 1000;
          // Get user tokens valid after time in milliseconds UTC.
          const validSinceUtc = new Date(user.tokensValidAfterTime).getTime();
          // Check if authentication time is older than valid since time.
          if (authTimeUtc < validSinceUtc) {
            throw new FirebaseAuthError(revocationErrorInfo);
          }
        }
        // All checks above passed. Return the decoded token.
        return decodedIdToken;
      });
  }
}



/**
 * Internals of an Auth instance.
 */
class AuthInternals implements FirebaseServiceInternalsInterface {
  /**
   * Deletes the service and its associated resources.
   *
   * @return {Promise<()>} An empty Promise that will be fulfilled when the service is deleted.
   */
  public delete(): Promise<void> {
    // There are no resources to clean up
    return Promise.resolve(undefined);
  }
}


/**
 * Auth service bound to the provided app.
 * An Auth instance can have multiple tenants.
 */
export class Auth extends BaseAuthImpl<AbstractAuthRequestHandler> implements FirebaseServiceInterface {

  public INTERNAL: AuthInternals = new AuthInternals();
  private readonly tenantManager_: TenantManager;
  private readonly app_: FirebaseApp;

  /**
   * @param {object} app The app for this Auth service.
   * @constructor
   */
  constructor(app: FirebaseApp) {
    super(app, new AuthRequestHandler(app));
    this.app_ = app;
    this.tenantManager_ = new TenantManager(app);
  }

  /**
   * Returns the app associated with this Auth instance.
   *
   * @return {FirebaseApp} The app associated with this Auth instance.
   */
  get app(): FirebaseApp {
    return this.app_;
  }

  /** @return The current Auth instance's tenant manager. */
  public tenantManager(): TenantManager {
    return this.tenantManager_;
  }
}

/**
 * The tenant aware Auth class.
 */
export class TenantAwareAuthImpl extends BaseAuthImpl<TenantAwareAuthRequestHandler> {
  public readonly tenantId: string;

  /**
   * The TenantAwareAuth class constructor.
   *
   * @param {object} app The app that created this tenant.
   * @param tenantId The corresponding tenant ID.
   * @constructor
   */
  constructor(app: FirebaseApp, tenantId: string) {
    const cryptoSigner = cryptoSignerFromApp(app);
    const tokenGenerator = new FirebaseTokenGenerator(cryptoSigner, tenantId);
    super(app, new TenantAwareAuthRequestHandler(app, tenantId), tokenGenerator);
    utils.addReadonlyGetter(this, 'tenantId', tenantId);
  }

  /**
   * Verifies a JWT auth token. Returns a Promise with the tokens claims. Rejects
   * the promise if the token could not be verified. If checkRevoked is set to true,
   * verifies if the session corresponding to the ID token was revoked. If the corresponding
   * user's session was invalidated, an auth/id-token-revoked error is thrown. If not specified
   * the check is not applied.
   *
   * @param {string} idToken The JWT to verify.
   * @param {boolean=} checkRevoked Whether to check if the ID token is revoked.
   * @return {Promise<DecodedIdToken>} A Promise that will be fulfilled after a successful
   *     verification.
   */
  public verifyIdToken(idToken: string, checkRevoked = false): Promise<DecodedIdToken> {
    return super.verifyIdToken(idToken, checkRevoked)
      .then((decodedClaims) => {
        // Validate tenant ID.
        if (decodedClaims.firebase.tenant !== this.tenantId) {
          throw new FirebaseAuthError(AuthClientErrorCode.MISMATCHING_TENANT_ID);
        }
        return decodedClaims;
      });
  }

  /**
   * Creates a new Firebase session cookie with the specified options that can be used for
   * session management (set as a server side session cookie with custom cookie policy).
   * The session cookie JWT will have the same payload claims as the provided ID token.
   *
   * @param {string} idToken The Firebase ID token to exchange for a session cookie.
   * @param {SessionCookieOptions} sessionCookieOptions The session cookie options which includes
   *     custom session duration.
   *
   * @return {Promise<string>} A promise that resolves on success with the created session cookie.
   */
  public createSessionCookie(
    idToken: string, sessionCookieOptions: SessionCookieOptions): Promise<string> {
    // Validate arguments before processing.
    if (!validator.isNonEmptyString(idToken)) {
      return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_ID_TOKEN));
    }
    if (!validator.isNonNullObject(sessionCookieOptions) ||
        !validator.isNumber(sessionCookieOptions.expiresIn)) {
      return Promise.reject(new FirebaseAuthError(AuthClientErrorCode.INVALID_SESSION_COOKIE_DURATION));
    }
    // This will verify the ID token and then match the tenant ID before creating the session cookie.
    return this.verifyIdToken(idToken)
      .then(() => {
        return super.createSessionCookie(idToken, sessionCookieOptions);
      });
  }

  /**
   * Verifies a Firebase session cookie. Returns a Promise with the tokens claims. Rejects
   * the promise if the token could not be verified. If checkRevoked is set to true,
   * verifies if the session corresponding to the session cookie was revoked. If the corresponding
   * user's session was invalidated, an auth/session-cookie-revoked error is thrown. If not
   * specified the check is not performed.
   *
   * @param {string} sessionCookie The session cookie to verify.
   * @param {boolean=} checkRevoked Whether to check if the session cookie is revoked.
   * @return {Promise<DecodedIdToken>} A Promise that will be fulfilled after a successful
   *     verification.
   */
  public verifySessionCookie(
    sessionCookie: string, checkRevoked = false): Promise<DecodedIdToken> {
    return super.verifySessionCookie(sessionCookie, checkRevoked)
      .then((decodedClaims) => {
        if (decodedClaims.firebase.tenant !== this.tenantId) {
          throw new FirebaseAuthError(AuthClientErrorCode.MISMATCHING_TENANT_ID);
        }
        return decodedClaims;
      });
  }
}