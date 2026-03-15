-- Postgresql users creation script
--  blogapp_user: User to create and view blog posts, 
--  blogapp_admin: User for the login control and create app users
-- blogapp_user_ro: User for read only access to the 
CREATE ROLE blogapp_user    WITH LOGIN PASSWORD 'blogpassword';
CREATE ROLE blogapp_admin   WITH LOGIN PASSWORD 'adminpassword';
create role blogapp_user_ro with login password 'blogpassword';
 create schema blogapp_admin authorization blogapp_admin;
 create schema blogapp_user authorization blogapp_user;
